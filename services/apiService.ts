
import { ai } from './geminiService';
import { Message } from '../types';
import { Part, GenerateContentResponse, Modality } from '@google/genai';

// Pure client-side implementation. No backend required.

/**
 * Transforms the message history from the frontend state into the format
 * expected by the Google GenAI API history parameter.
 */
function formatHistory(messages: Message[]): { role: 'user' | 'model'; parts: Part[] }[] {
    const history: { role: 'user' | 'model'; parts: Part[] }[] = [];
    // We only want the history, not the very last message which is the current prompt.
    const messagesToProcess = messages.slice(0, -1);

    for (const message of messagesToProcess) {
        // Skip empty model messages that are used for the typing indicator
        if (message.role === 'model' && !message.text) continue;

        const parts: Part[] = [];
        if (message.text) {
            parts.push({ text: message.text });
        }
        // Note: Image data is not typically added to history to save tokens/bandwidth
        // unless specifically needed for the immediate context.
        
        if (parts.length > 0) {
            history.push({ role: message.role, parts });
        }
    }
    return history;
}

/**
 * Streams chat response directly from the Gemini API using the SDK.
 * @param messages - The full message history from the component's state.
 * @param messageParts - The parts (text/image) of the new user message.
 */
export async function* streamChat(
    messages: Message[],
    messageParts: Part[]
): AsyncGenerator<GenerateContentResponse> {
    const history = formatHistory(messages);

    const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        history: history,
        config: {
            systemInstruction: "Bạn là một hướng dẫn viên du lịch ảo AI chuyên nghiệp về Quảng Trị. Hãy trả lời ngắn gọn, xúc tích, thân thiện. Tập trung vào các di tích lịch sử, văn hóa và danh lam thắng cảnh tại Quảng Trị."
        }
    });

    const result = await chat.sendMessageStream({ message: messageParts });

    for await (const chunk of result) {
        yield chunk as GenerateContentResponse;
    }
}

/**
 * Requests Text-to-Speech conversion directly from the Gemini API.
 * @param text The text to convert to speech.
 * @returns A base64 encoded audio string, or null if it fails.
 */
export const textToSpeech = async (text: string): Promise<string | null> => {
    if (!text.trim()) return null;
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: 'Kore' },
                    },
                },
            },
        });

        const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        return audioData || null;
    } catch (error) {
        console.error("Text-to-speech conversion failed:", error);
        return null;
    }
};
