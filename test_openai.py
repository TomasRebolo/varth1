import openai

# Set your API key here
openai.api_key = "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"  # Replace with your actual key

try:
    response = openai.ChatCompletion.create(
        model="gpt-3.5-turbo",
        messages=[{"role": "user", "content": "Hello, world!"}]
    )
    print("API key is functioning! Chat response:")
    print(response["choices"][0]["message"]["content"].strip())
except Exception as e:
    print("Error with API key:", e)