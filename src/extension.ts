import * as vscode from 'vscode';
import os from 'os';
import { executableIsAvailable, getDefaultModel, getNonce, systemPromptContent } from './utils';
import { getWebViewHtmlContent } from './chat';
import { ModelResponse, Ollama } from 'ollama';

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface chattingRecord {
    uguid: string;
    name: string;
    timestamp: string;
    messages: ChatMessage[];
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
let webview: vscode.Webview | null = null;
let currentRecord: chattingRecord | undefined = undefined;

interface MessageData{
    command: "loadRecord" | "chatResponse" | "newChat" |
    "ollamaInstallErorr" | "ollamaModelsNotDownloaded" |
    "showRecords" | "updateModelList" | "messageStreamEnded" | "error";
    text?: string;
    availableModels?: string[];
    selectedModel?: string;
    records?: chattingRecord[];
    uguid?: string;
}
function postMessage(data: MessageData) {
    if (webview) {
        webview.postMessage(data);
    }
}
function initCurrentRecord(name: string, context: vscode.ExtensionContext) {
    if (!currentRecord) {
        currentRecord = {
            uguid: getNonce(),
            name: name,
            timestamp: new Date().toLocaleTimeString(),
            messages: []
        };
        currentRecord.messages.push({
            role: "system",
            content: systemPromptContent
        });
        const records = context.globalState.get<chattingRecord[]>('ollamaChatRecord', []);
        records.push(currentRecord);
        context.globalState.update('ollamaChatRecord', records);
    }
}
function updateCurrentRecord(msg: ChatMessage, context: vscode.ExtensionContext) {
    if (currentRecord) {
        currentRecord.messages.push(msg);
        const records = context.globalState.get<chattingRecord[]>('ollamaChatRecord', []);
        const index = records.findIndex(value => value.uguid === currentRecord?.uguid);
        if (index < 0) {
            records.push(currentRecord);
            postMessage({
                command: "loadRecord",
                records: records,
                uguid: currentRecord.uguid
            });
        } else {
            records[index] = currentRecord;
        }
        context.globalState.update('ollamaChatRecord', records);
    }
}
export function activate(context: vscode.ExtensionContext) {
    globalThis.isRunningOnWindows = os.platform() === 'win32' ? true : false;
    globalThis.selectedModel = undefined;
    globalThis.stopResponse = false;
    globalThis.chatting = false;

    const config = vscode.workspace.getConfiguration('ollama-chat-rain');
    const serverUrl = config.get<string>('serverUrl') || 'http://localhost:11434';

    if (serverUrl === 'http://localhost:11434') {
        executableIsAvailable("ollama");
    }

    const extensionContext = context;
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('OllamaChat.View', {
        resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken) {
            webview = webviewView.webview;
            webview.options = {
                enableScripts: true,
                localResourceRoots: [extensionContext.extensionUri]
            };
            webview.html = getWebViewHtmlContent(extensionContext, webview);
            
            const ollamaInstance = new Ollama({
                host: serverUrl
            });

            let ollamaInstalled = true;
            if (serverUrl === 'http://localhost:11434') {
                ollamaInstalled = executableIsAvailable("ollama");
                if (ollamaInstalled === false) {
                    webview.postMessage({ command: "ollamaInstallErorr"});
                }
            }

            webview.onDidReceiveMessage(async (message: any) => {
                let responseText = "";

                if (message.command === 'chat') {
                    globalThis.stopResponse = false;
                    initCurrentRecord(message.question, extensionContext);
                    updateCurrentRecord({
                        role: 'user',
                        content: message.question
                    }, extensionContext);

                    try {
                        globalThis.chatting = true;
                        const response = await ollamaInstance.chat({
                            model: selectedModel || "",
                            messages: currentRecord?.messages,
                            stream: true,
                        });

                        for await (const part of response) {
                            if(globalThis.stopResponse){
                                postMessage({ command: "messageStreamEnded" });
                                response.abort();
                                return;
                            } else {
                                responseText += part.message.content;
                                postMessage({
                                    command: "chatResponse", 
                                    text: responseText,
                                    selectedModel: selectedModel
                                });
                            }
                        }

                        updateCurrentRecord({
                            role: 'assistant',
                            content: responseText
                        }, extensionContext);
                        postMessage({ command: "messageStreamEnded" });
                    } catch (error: any) {
                        if (error.name === 'AbortError') {
                            postMessage({ command: "messageStreamEnded" });
                        } else {
                            postMessage({
                                command: "error", 
                                text: error.message
                            });
                        }
                    } finally {
                        globalThis.chatting = false;
                    }
                } else if (message.command === "stopResponse") {
                    globalThis.stopResponse = true;
                } else if (message.command === "selectRecord" && !globalThis.chatting) {
                    let records = extensionContext.globalState.get<chattingRecord[]>('ollamaChatRecord', []);
                    currentRecord = records.find(item => item.uguid === message.uguid);
                    postMessage({
                        command: "loadRecord",
                        records: records,
                        uguid: currentRecord ? currentRecord.uguid : ""
                    });
                } else if (message.command === "deleteRecord" && !globalThis.chatting) {
                    let records = extensionContext.globalState.get<chattingRecord[]>('ollamaChatRecord', []);
                    records = records.filter(item =>item.uguid !== message.uguid);
                    await extensionContext.globalState.update('ollamaChatRecord', records);
                    if (currentRecord?.uguid === message.uguid) {
                        postMessage({ command: "newChat" });
                        currentRecord = undefined;
                    }
                    let uguid = "";
                    if (currentRecord) {
                        uguid = currentRecord.uguid;
                    } else if (records.length > 0) {
                        uguid = records[records.length - 1].uguid;
                    }
                    postMessage({
                        command: "loadRecord",
                        records: records,
                        uguid: uguid
                    });
                } else if (message.command === "selectedModel") {
                    selectedModel = message.selectedModel;
                } else if (message.command === 'log') {
                    console.log(message.msg);
                } else if (message.command === "pageLoaded") {
                    
                    const records = extensionContext.globalState.get<chattingRecord[]>('ollamaChatRecord', []);
                    if (records.length > 0) {
                        currentRecord = records[records.length - 1];
                    }
                    postMessage({
                        command: 'loadRecord',
                        records: records,
                        uguid: currentRecord ? currentRecord.uguid : ""
                    });
                    
                    getAvaialableModels(ollamaInstance).then(availableModelsMeta => {
                        const availableModels = availableModelsMeta.map((model) => model.name);
                        selectedModel = getDefaultModel(availableModels);

                        if (ollamaInstalled && globalThis.selectedModel) {
                            preloadModel(globalThis.selectedModel);
                        }
                        if (!selectedModel) {
                            postMessage({
                                command: "ollamaModelsNotDownloaded",
                                text: "No models available. Please download a model first."
                            });
                            return;
                        }
                        
                        postMessage({
                            command: "updateModelList",
                            availableModels: availableModels,
                            selectedModel: selectedModel
                        });
                    });

                    postMessage({command: "ollamaInstallErorr"});
                }
            });
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand("ollama-chat-rain.ShowRecord", () => {
        postMessage({ command: "showRecords" });
     }));
    context.subscriptions.push(vscode.commands.registerCommand("ollama-chat-rain.NewChat", () => {
        postMessage({ command: "newChat" });
        currentRecord = undefined;
        globalThis.stopResponse = true;

        let records = extensionContext.globalState.get<chattingRecord[]>('ollamaChatRecord', []);
        postMessage({
            command: "loadRecord",
            records: records,
            uguid: ""
        });
     }));
}

export function deactivate() { }
