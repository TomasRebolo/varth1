import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Global variables for bot audio and viseme data
let botAudioUrl = "";
let botVisemeData = [];
let currentTimeouts = [];

// STT variables
let isRecording = false;
let recognizer;
let micAccessGranted = false;
let audioStream = null;

const maleAvatars = ["avatar2.glb", "avatar4.glb", "avatar6.glb", "avatar8.glb", "avatar10.glb", "avatar12.glb"];
const femaleAvatars = ["avatar1.glb", "avatar3.glb", "avatar5.glb", "avatar7.glb", "avatar9.glb", "avatar11.glb"];

// Define the mapping of avatars to voices
const avatarToVoice = {
    // Male Avatars
    "avatar2.glb": "en-US-GuyNeural",       // Male 1 (Works)
    "avatar4.glb": "en-US-ChristopherNeural", // Male 2 (Available)
    "avatar6.glb": "en-US-BrandonNeural",    // Male 3 (Available)
    "avatar8.glb": "en-US-DavisNeural",      // Male 4 (Available)
    "avatar10.glb": "en-US-TonyNeural",      // Male 5 (Available)
    "avatar12.glb": "en-US-RogerNeural",     // Male 6 (Available)
    
    // Female Avatars
    "avatar1.glb": "en-US-JennyNeural",     // Female 1 (Works)
    "avatar3.glb": "en-US-AriaNeural",      // Female 2 (Available)
    "avatar5.glb": "en-US-SaraNeural",      // Female 3 (Available)
    "avatar7.glb": "en-US-NancyNeural",     // Female 4 (Available)
    "avatar9.glb": "en-US-MichelleNeural",  // Female 5 (Available)
    "avatar11.glb": "en-US-JaneNeural"      // Female 6 (Available)
};

// Request microphone permission on page load
async function requestMicrophonePermission() {
    try {
        if (!audioStream) {
            audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log("🎤 Microphone access granted.");
            micAccessGranted = true;
        }
    } catch (error) {
        alert("🚨 Microphone permission is required for STT. Please enable it in your browser settings.");
        console.error("Microphone permission denied:", error);
        return false;
    }
    return true;
}

// Initialize Azure STT
async function initAzureSTT() {
    // Fetch the Azure Speech Key from the backend
    const response = await fetch('/azure-key');
    const data = await response.json();
    const azureSpeechKey = data.azure_key;

    if (!azureSpeechKey) {
        console.error('Azure Speech Key not found');
        return;
    }

    const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(azureSpeechKey, "westeurope");
    const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
    recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

    recognizer.recognizing = (s, e) => {
        console.log("Recognizing:", e.result.text);
        document.getElementById('chatInput').value = e.result.text; // Update input field in real-time
    };

    recognizer.recognized = (s, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
            console.log("Recognized:", e.result.text);
            document.getElementById('chatInput').value = e.result.text; // Final transcription
        }
    };

    recognizer.canceled = (s, e) => {
        console.log("Canceled:", e.errorDetails);
        alert("STT Error: " + e.errorDetails);
    };

    recognizer.sessionStopped = (s, e) => {
        console.log("Session stopped.");
        isRecording = false;
        document.getElementById('sttBtn').classList.remove('recording');
    };
}


// Toggle STT recording
document.getElementById('sttBtn').onclick = async () => {
    if (!recognizer) {
        const micGranted = await requestMicrophonePermission();
        if (!micGranted) return;
        initAzureSTT();
    }

    if (isRecording) {
        recognizer.stopContinuousRecognitionAsync(); // Stop recording
        isRecording = false;
        document.getElementById('sttBtn').classList.remove('recording');
    } else {
        recognizer.startContinuousRecognitionAsync(); // Start recording
        isRecording = true;
        document.getElementById('sttBtn').classList.add('recording');
    }
};

// Chat functionality
document.getElementById('sendBtn').onclick = async () => {
    const chatInput = document.getElementById('chatInput');
    const text = chatInput.value.trim();
    const selectedAvatar = document.getElementById("avatarDropdown").value;
    const selectedVoice = avatarToVoice[selectedAvatar]; // Ensure the voice is being selected correctly

    if (!text || !selectedVoice) return; // Prevent sending empty text or missing voice

    addMessage(text, 'user-message');
    chatInput.value = '';

    // Log the values of text and selectedVoice before sending
    console.log({ text, voice: selectedVoice }); // Check what's being sent to the backend
    
    const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: selectedVoice }) // Ensure 'voice' is included
    });

    if (!res.ok) {
        alert('Error contacting backend.');
        return;
    }

    const data = await res.json();
    botAudioUrl = `http://localhost:8000${data.audio_url}`;
    botVisemeData = data.viseme_data;

    addMessage(data.bot_reply, 'bot-message');
    const audioPlayer = document.getElementById('audioPlayer');
    audioPlayer.src = botAudioUrl;
    scrollChatToBottom();

    // Automatically play the audio to start the lip sync
    audioPlayer.play();
};

function addMessage(text, className) {
    const chatbox = document.getElementById('chatbox');
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', className);
    msgDiv.innerText = text;
    chatbox.appendChild(msgDiv);
}

function scrollChatToBottom() {
    const chatbox = document.getElementById('chatbox');
    chatbox.scrollTop = chatbox.scrollHeight;
}

// Avatar Lip Sync Animation via audio onplay event
document.getElementById('audioPlayer').onplay = () => {
    console.log("TTS audio started, synchronizing lip sync...");
    currentTimeouts.forEach(clearTimeout);
    currentTimeouts = [];

    const audioPlayer = document.getElementById('audioPlayer');
    let startTime = performance.now();

    function syncAnimation() {
        const currentAudioTime = audioPlayer.currentTime * 1000; // Convert to milliseconds
        botVisemeData.forEach(({ viseme, time }, index) => {
            if (time <= currentAudioTime && !currentTimeouts[index]) {
                const nextTime = botVisemeData[index + 1] ? botVisemeData[index + 1].time : time + 200;
                let duration = nextTime - time;
                animateViseme(viseme, 1.0, duration * 0.5);
                setTimeout(() => animateViseme(viseme, 0.0, duration * 0.5), duration * 0.8);
                currentTimeouts[index] = true;
            }
        });
        requestAnimationFrame(syncAnimation);
    }

    syncAnimation();
};

// Three.js scene variables
let scene, camera, renderer, avatar;

function initThreeJS() {
    scene = new THREE.Scene();
    const canvas = document.getElementById('avatarCanvas');
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(0, 1.5, 3);

    renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: true
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);

    loadAvatar('avatar2.glb');
    animate();
}

function loadAvatar(avatarFile) {
    const loader = new GLTFLoader();
    loader.load(avatarFile, (gltf) => {
        if (avatar) {
            scene.remove(avatar);
        }

        avatar = gltf.scene;
        scene.add(avatar);
        avatar.scale.set(7, 7, 7);
        avatar.position.set(0, -3, -0.5);
        console.log("Loaded Avatar:", avatarFile);

                avatar.traverse(child => {
            if (child.isMesh && child.morphTargetDictionary) {
                console.log('Blend shapes for this mesh:', child.morphTargetDictionary);
            }
        });
    });
}

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

// Viseme to BlendShape Mapping
const visemeToBlendShape = {
    0: { "viseme_sil": 0.2, "jawOpen": 0.1 },
    1: { "viseme_PP": 0.5, "mouthPucker": 0.4, "jawOpen": 0.1 },
    2: { "viseme_DD": 0.4, "viseme_SS": 0.4, "jawOpen": 0.2, "tongueOut": 0.1 },
    3: { "viseme_TH": 0.4, "tongueOut": 0.3, "jawOpen": 0.2 },
    4: { "viseme_aa": 0.6, "jawOpen": 0.6, "tongueOut": 0.3 },
    5: { "viseme_O": 0.5, "mouthPucker": 0.5, "jawOpen": 0.3 },
    6: { "mouthSmile": 0.4, "jawOpen": 0.2 },
    7: { "viseme_RR": 0.5, "jawOpen": 0.2, "mouthPucker": 0.3 },
    8: { "mouthSmile": 0.5, "jawOpen": 0.3 },
    9: { "mouthSmile": 0.4, "jawOpen": 0.2 },
    10: { "mouthSmile": 0.5, "jawOpen": 0.2 },
    11: { "viseme_U": 0.6, "mouthFunnel": 0.5, "jawOpen": 0.2 },
    12: { "viseme_U": 0.6, "mouthFunnel": 0.5, "jawOpen": 0.3 },
    13: { "viseme_aa": 0.5, "mouthSmile": 0.4, "jawOpen": 0.4 },
    14: { "viseme_O": 0.5, "mouthPucker": 0.5, "jawOpen": 0.3 },
    15: { "viseme_O": 0.5, "mouthPucker": 0.5, "jawOpen": 0.3 },
    16: { "viseme_aa": 0.5, "mouthPucker": 0.5, "jawOpen": 0.4 },
    17: { "viseme_CH": 0.4, "viseme_SS": 0.4, "jawOpen": 0.2 },
    18: { "viseme_TH": 0.4, "tongueOut": 0.3, "jawOpen": 0.2 },
    19: { "viseme_nn": 0.3, "jawOpen": 0.2 },
    20: { "viseme_CH": 0.4, "viseme_SS": 0.4, "jawOpen": 0.2 },
    21: { "viseme_kk": 0.5, "jawOpen": 0.3, "tongueOut": 0.3 }
};

// Smooth interpolation for lip-sync using requestAnimationFrame
function animateViseme(viseme, targetValue, duration) {
    if (!avatar) return;
    avatar.traverse(child => {
        if (child.isMesh && child.morphTargetDictionary) {
            const blendShapes = visemeToBlendShape[viseme] || {};
            Object.keys(blendShapes).forEach(shape => {
                const index = child.morphTargetDictionary[shape];
                if (index !== undefined) {
                    // Determine the new target value based on the blend shape weight
                    const newValue = targetValue * blendShapes[shape];
                    // Use GSAP to tween the morphTargetInfluences[index] to newValue over the given duration (in seconds)
                    gsap.to(child.morphTargetInfluences, {
                        [index]: newValue,
                        duration: duration / 1000, // convert milliseconds to seconds
                        ease: "power1.out"
                    });
                }
            });
        }
    });
}

// When the gender is selected, update the avatar dropdown
document.getElementById("genderSelector").addEventListener("change", function(event) {
    const gender = event.target.value;
    const avatarDropdown = document.getElementById("avatarDropdown");
    // Clear existing options and add the default option
    avatarDropdown.innerHTML = '<option value="" disabled selected>Select Avatar</option>';
    
    const avatars = gender === "male" ? maleAvatars : femaleAvatars;
    
    avatars.forEach(avatar => {
        const option = document.createElement("option");
        option.value = avatar;
        option.textContent = avatar; // You can also use a prettier label if you wish
        avatarDropdown.appendChild(option);
    });
});

// When an avatar is selected, load it using your existing function
document.getElementById("avatarDropdown").addEventListener("change", function(event) {
    const selectedAvatar = event.target.value;
    const selectedVoice = avatarToVoice[selectedAvatar]; // Automatically select the voice based on avatar
    loadAvatar(selectedAvatar);

    // Send chat request with the selected voice
    const chatInput = document.getElementById('chatInput');
    const text = chatInput.value.trim();
    if (!text || !selectedVoice) return;

    addMessage(text, 'user-message');
    chatInput.value = '';


    fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: selectedVoice }) // Send the selected voice
    }).then(res => {
        if (!res.ok) {
            alert('Error contacting backend.');
            return;
        }
        return res.json();
    }).then(data => {
        botAudioUrl = `http://localhost:8000${data.audio_url}`;
        botVisemeData = data.viseme_data;

        addMessage(data.bot_reply, 'bot-message');
        const audioPlayer = document.getElementById('audioPlayer');
        audioPlayer.src = botAudioUrl;
        scrollChatToBottom();

        // Automatically play the audio to start the lip sync
        audioPlayer.play();
    });
});

// Initialize Three.js and request microphone permission
initThreeJS();
requestMicrophonePermission();
