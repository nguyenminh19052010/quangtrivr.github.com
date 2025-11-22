export interface Message {
    role: 'user' | 'model';
    text: string;
    imageData?: string;
}