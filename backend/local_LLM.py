from llama_cpp import Llama

# Load the model once (do this at module level for efficiency)
try:
    llm = Llama(model_path="C:/LocalAIModel/Llama/model.gguf", n_ctx=2048, n_gpu_layers=32)
    print("[INFO] Llama model loaded with n_gpu_layers=32 (GPU acceleration enabled if supported)")
except Exception as e:
    print(f"[WARN] GPU load failed: {e}\nFalling back to CPU-only mode...")
    llm = Llama(model_path="C:/LocalAIModel/Llama/model.gguf", n_ctx=2048, n_gpu_layers=0)
    print("[INFO] Llama model loaded with n_gpu_layers=0 (CPU-only mode)")

def analyze_exif_with_llm(exif_json: dict) -> str:
    """
    Analyze EXIF metadata using a local Llama model.
    Returns a natural language summary or risk assessment.
    """
    prompt = (
        "You are a privacy expert. Given this EXIF JSON, briefly list only the most critical privacy risks and sensitive information. Be concise.\n"
        "If there are no risks, say 'No significant privacy risks detected.'\n\n"
        f"EXIF JSON: {exif_json}\n"
        "Brief Analysis:"
    )
    output = llm(prompt, max_tokens=256, stop=["\n\n"])
    text = output["choices"][0]["text"].strip()
    end_marker = "<END_OF_ANALYSIS>"
    if end_marker in text:
        text = text.split(end_marker, 1)[0] + end_marker
    return text