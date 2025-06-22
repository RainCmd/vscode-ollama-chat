import * as vscode from 'vscode';
import os from 'os';
import { executableIsAvailable, getDefaultModel, systemPromptContent } from './utils';
import { getWebViewHtmlContent } from './chat';
import { ModelResponse, Ollama } from 'ollama';

// Add interface for message
interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// Update ChatHistoryItem to include messages
interface ChatHistoryItem {
    question: string;
    answer: string;
    timestamp: string;
    messages?: ChatMessage[]; // Add this to store conversation context
}

async function preloadModel(model: string) {
    try {
        const config = vscode.workspace.getConfiguration('ollama-chat-rain');
        const serverUrl = config.get<string>('serverUrl') || 'http://localhost:11434';

        const ollamaInstance = new Ollama({
            host: serverUrl
        });

        await ollamaInstance.generate({
            model: model,
            prompt: "",
            stream: false,
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Error preloading model: ${error}`);
    }
}

async function getAvaialableModels(ollamaInstance:Ollama): Promise<ModelResponse[]>{
    const availableModels = await ollamaInstance.list();
    return availableModels.models;
}

export function activate(context: vscode.ExtensionContext) {
    globalThis.isRunningOnWindows = os.platform() === 'win32' ? true : false;
    globalThis.selectedModel = undefined;
    globalThis.stopResponse = false;

    const config = vscode.workspace.getConfiguration('ollama-chat-rain');
    const serverUrl = config.get<string>('serverUrl') || 'http://localhost:11434';

    if (serverUrl === 'http://localhost:11434') {
        executableIsAvailable("ollama");
    }

    const extensionContext = context;
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('OllamaChatView', {
        resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken) {
            const view = webviewView.webview;
            view.options = {
                enableScripts: true,
                localResourceRoots: [extensionContext.extensionUri]
            };
            view.html = getWebViewHtmlContent(extensionContext, view);
            
            const ollamaInstance = new Ollama({
                host: serverUrl
            });
            let currentConversation: ChatMessage[] = [];

            let ollamaInstalled = true;
            if (serverUrl === 'http://localhost:11434') {
                ollamaInstalled = executableIsAvailable("ollama");
                if (ollamaInstalled === false) {
                    view.postMessage({ command: "ollamaInstallErorr", text: "ollama not installed" });
                }
            }

            getAvaialableModels(ollamaInstance).then(availableModelsMeta => {
                const availableModels = availableModelsMeta.map((model) => model.name);
                selectedModel = getDefaultModel(availableModels);

                if (ollamaInstalled && globalThis.selectedModel) {
                    preloadModel(globalThis.selectedModel);
                }

                if (!selectedModel) {
                    view.postMessage({
                        command: "ollamaModelsNotDownloaded",
                        text: "No models available. Please download a model first."
                    });
                    return;
                }

                view.postMessage({ availableModels: availableModels, selectedModel: selectedModel });

                const chatHistory = extensionContext.globalState.get<ChatHistoryItem[]>('ollamaChatHistory', []);
                view.postMessage({
                    command: 'loadHistory',
                    history: chatHistory
                });

                // const editor = vscode.window.activeTextEditor;
                // if (!editor) {
                //     vscode.window.showWarningMessage('No active text editor found');
                //     return;
                // }

                // const selection = editor.selection;
                // const selectedText = editor.document.getText(selection);

                // if (!selectedText) {
                //     vscode.window.showWarningMessage('No text selected');
                //     return;
                // }

                // const initialQuestion = `Selected text:\n\`\`\`\n${selectedText}\n\`\`\`\n\n`;
                // if (initialQuestion) {
                //     view.postMessage({
                //         command: 'initialQuestion',
                //         question: initialQuestion
                //     });
                // }
            });

            view.onDidReceiveMessage(async (message: any) => {
                let responseText = "";

                if (message.command === 'chat' || message.command === 'stopResponse') {
                    if(message.command === 'chat'){
                        globalThis.stopResponse = false;
                    } else if(message.command === 'stopResponse'){
                        globalThis.stopResponse = true;
                    }

                    const historyItem: ChatHistoryItem = {
                        question: message.question,
                        answer: '',
                        timestamp: new Date().toLocaleTimeString(),
                        messages: [...currentConversation]
                    };

                    const currentHistory = extensionContext.globalState.get<ChatHistoryItem[]>('ollamaChatHistory', []);
                    const updatedHistory = [historyItem, ...currentHistory].slice(0, 50);

                    // Add system prompt only if conversation is empty
                    if (currentConversation.length === 0) {
                        currentConversation.push({ 
                            role: 'system', 
                            content: systemPromptContent 
                        });
                    }

                    currentConversation.push({
                        role: 'user',
                        content: message.question
                    });

                    try {
                        const response = await ollamaInstance.chat({
                            model: selectedModel || "",
                            messages: currentConversation,
                            stream: true,
                        });

                        // Collect full response
                        for await (const part of response) {
                            if(globalThis.stopResponse){
                                view.postMessage({messageStreamEnded: true});
                                return;
                            }
                            responseText += part.message.content;
                            view.postMessage({
                                command: "chatResponse", 
                                text: responseText,
                                selectedModel: selectedModel
                            });
                        }

                        // Add assistant response to conversation
                        currentConversation.push({
                            role: 'assistant',
                            content: responseText
                        });

                        // Update history item with the complete answer
                        historyItem.answer = responseText;
                        historyItem.messages = [...currentConversation];
                        await extensionContext.globalState.update('ollamaChatHistory', updatedHistory);

                        view.postMessage({
                            command: "updateHistoryAnswer",
                            question: message.question,
                            answer: responseText,
                            timestamp: historyItem.timestamp
                        });

                        view.postMessage({messageStreamEnded: true});
                    } catch (error: any) {
                        if (error.name === 'AbortError') {
                            view.postMessage({messageStreamEnded: true});
                        } else {
                            view.postMessage({
                                command: "error", 
                                text: "An error occurred while processing your request"
                            });
                        }
                    }
                } else if (message.command === "deleteHistoryItem") {
                    // Handle deleting individual history item
                    const currentHistory = extensionContext.globalState.get<ChatHistoryItem[]>('ollamaChatHistory', []);
                    const updatedHistory = currentHistory.filter(item =>
                        !(item.question === message.question && item.timestamp === message.timestamp)
                    );
                    await extensionContext.globalState.update('ollamaChatHistory', updatedHistory);
                } else if (message.command === "selectedModel") {
                    selectedModel = message.selectedModel;
                } else if (message.command === "newChat") {
                    currentConversation = [];
                }
            });
        }
    }));
}

export function deactivate() { }
