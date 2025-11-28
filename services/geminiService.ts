import { GoogleGenAI } from "@google/genai";

// The AI instance is still needed for the Live API, which requires a direct
// low-latency connection from the client and cannot be easily proxied.
// Chat and TTS will go through the backend proxy.
export const ai = new GoogleGenAI({ apiKey:"AIzaSyAgcF6VE8Bbhxmtk39sIfWmZpdw3p7QI5A"  });
