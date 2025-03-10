import os
import uuid
import openai
import azure.cognitiveservices.speech as speechsdk
from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import asyncio
import time
from contextlib import asynccontextmanager
from dotenv import load_dotenv
import os

load_dotenv()  # Load environment variables from .env file

# Azure configuration
AZURE_SPEECH_KEY = os.getenv("AZURE_SPEECH_KEY")
AZURE_REGION = os.getenv("AZURE_REGION")
#AZURE_BOT_ENDPOINT = os.getenv("AZURE_BOT_ENDPOINT")
#AZURE_BOT_KEY = os.getenv("AZURE_BOT_KEY")
openai.api_key = os.getenv("OPENAI_API_KEY")


OUTPUT_DIR = "output_audio"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Dictionary to track files and their expiration times
file_expirations = {}

# Lifespan handler
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Clean up existing files and start periodic cleanup
    for filename in os.listdir(OUTPUT_DIR):
        file_path = os.path.join(OUTPUT_DIR, filename)
        if os.path.isfile(file_path):
            os.remove(file_path)
            print(f"Cleaned up old file on startup: {file_path}")
    
    # Start the periodic cleanup task
    cleanup_task = asyncio.create_task(periodic_cleanup())

    try:
        yield  # Run the app
    finally:
        # Shutdown: Cancel the cleanup task and clean up remaining files
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            print("Periodic cleanup task cancelled.")
        for file_path in list(file_expirations.keys()):
            if os.path.exists(file_path):
                os.remove(file_path)
                print(f"Cleaned up file on shutdown: {file_path}")
            file_expirations.pop(file_path, None)

# Initialize FastAPI app with lifespan
app = FastAPI(lifespan=lifespan)


# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve audio files
app.mount("/output_audio", StaticFiles(directory=OUTPUT_DIR), name="output_audio")

class ChatRequest(BaseModel):
    text: str
    voice: str  # Add a voice field to dynamically pass the selected voice


@app.get("/azure-key")
async def get_azure_key():
    azure_key = os.getenv("AZURE_SPEECH_KEY")
    return {"azure_key": azure_key}


# Function to delete a file after a delay
async def delete_file_after_delay(file_path: str, delay: int = 120):  # 120 seconds = 2 minutes
    await asyncio.sleep(delay)
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            print(f"Deleted file: {file_path}")
            file_expirations.pop(file_path, None)  # Remove from tracking
    except Exception as e:
        print(f"Error deleting file {file_path}: {e}")

# Periodic cleanup task
async def periodic_cleanup():
    while True:
        current_time = time.time()
        for file_path, expiry in list(file_expirations.items()):
            if current_time >= expiry:
                try:
                    if os.path.exists(file_path):
                        os.remove(file_path)
                        print(f"Periodic cleanup: Deleted {file_path}")
                    file_expirations.pop(file_path)
                except Exception as e:
                    print(f"Error in periodic cleanup for {file_path}: {e}")
        await asyncio.sleep(60)  # Check every minute

@app.post("/stt")
async def stt(file: UploadFile = File(...)):
    try:
        # Convert uploaded audio file to stream
        audio_data = await file.read()

        # Azure STT configuration
        speech_config = speechsdk.SpeechConfig(subscription=AZURE_SPEECH_KEY, region=AZURE_REGION)
        audio_config = speechsdk.audio.AudioConfig(stream=speechsdk.audio.PushAudioInputStream.create_push_stream())

        push_stream = audio_config.stream
        push_stream.write(audio_data)

        recognizer = speechsdk.SpeechRecognizer(speech_config, audio_config)
        result = recognizer.recognize_once_async().get()

        if result.reason == speechsdk.ResultReason.RecognizedSpeech:
            return {"recognized_text": result.text}
        else:
            raise HTTPException(status_code=500, detail="STT recognition failed.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat")
async def chat(request: ChatRequest):
    user_text = request.text
    voice = request.voice

    try:
        response = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": user_text}]
        )
    except Exception as e:
        print(f"OpenAI API error: {e}")
        raise HTTPException(status_code=500, detail=f"OpenAI API error: {str(e)}")

    bot_reply = response.choices[0].message.content.strip()

    speech_config = speechsdk.SpeechConfig(subscription=AZURE_SPEECH_KEY, region=AZURE_REGION)
    speech_config.speech_synthesis_voice_name = voice

    filename = f"{uuid.uuid4()}.mp3"
    audio_path = os.path.join(OUTPUT_DIR, filename)
    viseme_data = []

    def viseme_callback(evt):
        viseme_id = evt.viseme_id
        timestamp = evt.audio_offset / 10000
        viseme_data.append({
            "viseme": viseme_id,
            "time": timestamp
        })

    audio_config = speechsdk.audio.AudioOutputConfig(filename=audio_path)
    synthesizer = speechsdk.SpeechSynthesizer(speech_config, audio_config)
    synthesizer.viseme_received.connect(viseme_callback)

    try:
        result = synthesizer.speak_text_async(bot_reply).get()
        if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            audio_url = f"/output_audio/{filename}"
            # Schedule file deletion after 2 minutes
            file_expirations[audio_path] = time.time() + 120  # Track expiration time (2 minutes from now)
            asyncio.create_task(delete_file_after_delay(audio_path))
            return {"bot_reply": bot_reply, "audio_url": audio_url, "viseme_data": viseme_data}
        else:
            print(f"TTS synthesis failed: {result.reason}")
            raise HTTPException(status_code=500, detail="TTS synthesis failed.")
    except Exception as e:
        print(f"TTS synthesis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

app.mount("/", StaticFiles(directory="static", html=True), name="static")

# Run the server directly
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)