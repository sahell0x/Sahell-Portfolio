# Purple Sky Infotech Voice Platform

## Voice Agent Orchestration and Sub-1500ms Latency
At Purple Sky Infotech in Barwani, Madhya Pradesh, Sahil architected the voice agent orchestration layer using Pipecat and asynchronous processing. The architecture achieves real-time conversational voice with end-to-end latency under 1500 ms, supporting diverse STT, TTS, and LLM providers such as OpenAI, Gemini, Faster-Whisper, and vLLM.

## On-Premises 8x V100 GPU Server and 90% Cost Cut
Sahil deployed Qwen2.5-72B-Instruct using vLLM with tool calling, paired with Faster-Whisper large-v3 for low-latency speech transcription, on an on-premises 8x V100 GPU server. This on-premise infrastructure slashed LLM development and testing costs by 90% compared to using hosted cloud API providers.

## High-Performance RAG Microservice Architecture
Sahil built a high-performance RAG microservice for the voice agent platform using LangChain, Pinecone vector database, and OpenAI text-embedding-3-small. The ingestion and retrieval pipeline integrates AWS S3 for document storage, AWS SQS for resilient request queuing, and asynchronous Celery workers, delivering retrieval latency under 300 ms across 100,000+ chunks.

## Telephony Integrations and Automated Retry Handling
Sahil integrated multiple telephony providers—including Twilio, Plivo, and Vobiz—into the voice platform, along with automated call retry handling and resilient fallback mechanisms. This backend allowed scaling concurrent active calls by over 60%.
