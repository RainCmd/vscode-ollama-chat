const vscode = acquireVsCodeApi();
const chatContainer = document.getElementById('chatContainer');
const questionInput = document.getElementById('questionInput');
const submitBtn = document.getElementById('submitBtn');
const modelSelector = document.getElementById('modelSelector');
const historyPanel = document.getElementById('historyPanel');
const closeHistoryBtn = document.getElementById('closeHistoryBtn');
const historyList = document.getElementById('historyList');
const historyCount = document.getElementById('historyCount');
const historySearch = document.getElementById('historySearch');
const sendIcon = document.getElementById('sendIcon');
const stopIcon = document.getElementById('stopIcon');

const contextNumberBtn = document.getElementById('contextNumberBtn');
const contextNumber = document.getElementById('contextNumber');

const includePanel = document.getElementById('includePanel');
const addInclude = document.getElementById('addInclude');
const includeCurrent = document.getElementById('includeCurrent');
const includeIcon = document.getElementById('includeIcon');
const includeCloseIcon = document.getElementById('includeCloseIcon');
const includeContent = document.getElementById('includeContent');

let currentAssistantMessage = null;
let autoScrollEnabled = true;  // flag to control auto-scroll
let isGenerating = false;
let currentInclude = "";
let isCurrentInclude = false;
let includePaths = [];

function CW(msg) {
    vscode.postMessage({ command: "log", msg });
}

contextNumberBtn.onclick = () => vscode.postMessage({ command: "setContextNumber" });
function setContextNumber(value) {
    contextNumber.textContent = `x${value}`;
}

function getFileName(path) {
    let index = path.lastIndexOf('/');
    if (index < 0) {
        index = path.lastIndexOf('\\');
    }
    return path.substring(index + 1);
}
function setCurrentInclude(path, include) {
    isCurrentInclude = include;
    if (include) {
        includeIcon.style.display = "block";
        includeCloseIcon.style.display = "none";
        includeCurrent.className = "pl-2 pr-2 rounded-lg shadow-lg flex gap-2 text-[#7fff] border border-[#4444]";
    } else {
        includeIcon.style.display = "none";
        includeCloseIcon.style.display = "block";
        includeCurrent.className = "pl-2 pr-2 rounded-lg shadow-lg flex gap-2 text-[#7ff7] border border-[#4444]";
    }
    if (path) {
        currentInclude = path;
        includeCurrent.style.display = "";
        includeContent.setAttribute("title", path);
        includeContent.textContent = getFileName(path);
    } else {
        includeCurrent.style.display = "none";
    }
}
function updateIncludePaths(path, include) {
    if (include) {
        if (!includePaths.includes(path)) {
            includePaths.push(path);
            
            const div = document.createElement('div');
            div.title = path;
            div.className = 'pl-2 pr-2 rounded-lg shadow-lg flex gap-2 text-[#7fff] border border-[#4444]';
            div.innerHTML = `
                <button title="${path}">${getFileName(path)}</button>
                <button title="取消引用" class="codicon codicon-chrome-close"></button>
            `;
            includePanel.appendChild(div);
            div.onclick = () => vscode.postMessage({ command: "selectFile", path: path });
            div.querySelector(".codicon").addEventListener('click', e => {
                e.stopPropagation();
                updateIncludePaths(path, false);
            });
        }
    } else if(includePaths.includes(path)) {
        includePaths = includePaths.filter(value => value !== path);
        const dels = [];
        for (let index = 0; index < includePanel.children.length; index++) {
            const element = includePanel.children[index];
            if (element.title === path) {
                dels.push(element);
            }
        }
        dels.forEach(value => value.remove());
    }
}
addInclude.onclick = () => vscode.postMessage({ command: "addInclude" });
includeCurrent.onclick = () => vscode.postMessage({ command: "switchIncludeState" });

function scrollToBottomIfNecessary() {
    if (autoScrollEnabled) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

chatContainer.addEventListener('scroll', () => {
    // If near the bottom (within 50px), allow auto scrolling.
    if (chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 50) {
        autoScrollEnabled = true;
    } else {
        autoScrollEnabled = false;
    }
});

window.onload = function() {
    questionInput.focus();
    vscode.postMessage({ command: "pageLoaded" });
};

document.addEventListener('DOMContentLoaded', () => {
    hljs.configure({ignoreUnescapedHTML: true});
    hljs.addPlugin(new CopyButtonPlugin({ autohide: false }));
});

function updateInputHeight() {
    questionInput.style.height = 'auto';
    
    const maxHeight = 200;
    if(questionInput.scrollHeight > maxHeight){
        questionInput.style.overflow = 'auto';
        questionInput.style.height = maxHeight + 'px';
    }else{
        questionInput.style.overflow = 'hidden';
        questionInput.style.height = questionInput.scrollHeight + 'px';
    }
}
questionInput.addEventListener('input', updateInputHeight);
updateInputHeight();

const md = markdownit({
    highlight: (str, lang) => {
        if (lang && hljs.getLanguage(lang)) {
            try {
                return `<pre class="bg-[#2222] rounded p-1 my-1 border border-[#0ac7] overflow-x-auto"><code class="hljs language-${lang}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
            } catch (__) {}
        }
        return `<pre class="bg-[#2222] rounded p-1 my-1 border border-[#0ac7]"><code>${md.utils.escapeHtml(str)}</code></pre>`;
    }
});

function populateModelSelector(availableModels, selectedModel) {
    modelSelector.innerHTML = ''; // clear existing models
    availableModels.forEach((model) => {
        const option = new Option(model, model);
        option.className = 'bg-[#2d2d2d]';
        modelSelector.add(option);
    });
    document.getElementById('modelSelector').value = selectedModel;
}

function addMessage(content, isUser = true) {
    removeLoading();

    const messageDiv = document.createElement('div');
    messageDiv.className = `flex ${isUser ? 'justify-end' : 'justify-start'} w-full`;

    const border = isUser
        ? 'bg-[#0066AD44] text-[#ffffff]'
        : 'bg-[#0000] text-[#d4d4d4] border border-[#40404022] w-full';
    if (!isUser) {
        content = md.render(content);
    }
    content = content.trim();
    messageDiv.innerHTML =
        `<div class="pl-2 pr-2 rounded-lg shadow-lg prose max-w-none ${border}">
            <div class="whitespace-pre-wrap [&_a]:text-[#3794ff] [&_a:hover]:text-[#4aa0ff] [&_code]:bg-[#0000]">${content}</div>
        </div>`;

    chatContainer.appendChild(messageDiv);

    scrollToBottomIfNecessary();
    return messageDiv;
}

function updateLastAssistantMessage(content) {
    removeLoading();

    if (currentAssistantMessage) {
        if (currentAssistantMessage.style.display === "none") {
            currentAssistantMessage.style.display = "block";
        }
        const contentDiv = currentAssistantMessage.querySelector('.whitespace-pre-wrap');
        if (contentDiv) {
            contentDiv.innerHTML = md.render(content);
            hljs.highlightAll();
        }
    } else {
        // In case no block exists, create one.
        currentAssistantMessage = addMessage(content, false);
    }

    scrollToBottomIfNecessary();
}

function removeLoading() {
    const loadingIndicator = chatContainer.querySelector('.loading-indicator');
    if (loadingIndicator) {
        loadingIndicator.remove();
    }
}

function showLoading() {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'flex justify-center loading-indicator mb-6';
    loadingDiv.innerHTML = `
        <div class="max-w-3xl p-4 rounded-lg bg-[#25252633] border border-[#404040] w-full">
            <div class="flex items-center space-x-3">
                <div class="loader h-2 w-2 border-2 border-t-[#0e639c]"></div>
                <span class="text-[#858585] text-sm font-medium">处理请求中...</span>
            </div>
        </div>
    `;
    chatContainer.appendChild(loadingDiv);

    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function updateRecordCount() {
    if (historyCount) {
        const count = historyList.children.length;
        historyCount.textContent = count.toString();
    }
}

function filterHistory(searchText) {
    const historyItems = Array.from(historyList.children);
    const searchLower = searchText.toLowerCase();
    
    historyItems.forEach(item => {
        const question = item.querySelector('p').textContent.toLowerCase();
        if (question.includes(searchLower)) {
            item.style.display = 'block';
        } else {
            item.style.display = 'none';
        }
    });
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

historySearch.addEventListener('input', debounce((e) => {
    filterHistory(e.target.value);
}, 300));

function addRecords(records, current) {
    historyList.innerHTML = '';
    records.forEach(record => {
        const recordItem = document.createElement('div');
        const bg = record.uguid === current ? "bg-[#0377] hover:bg-[#07f7]" : "bg-[#0000] hover:bg-[#0002]";
        recordItem.className = `p-3 crounded-lg ${bg} ursor-pointer transition-colors group relative`;
        recordItem.setAttribute('match-text', record.name);
        const truncatedName = record.name.length > 60 
            ? record.name.substring(0, 57) + '...' 
            : record.name;
            
        recordItem.innerHTML = `
            <div class="flex justify-between items-start gap-1">
                <p class="text-sm text-[#d4d4d4] group-hover:text-white transition-colors">${truncatedName}</p>
                <div class="flex items-center gap-2">
                    <span class="text-xs text-[#858585]">${record.timestamp}</span>
                    <button class="delete-history-item opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-[#ff444444] rounded">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-[#858585] hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>
        `;
        
        recordItem.onclick = () => {
            vscode.postMessage({
                command: "selectRecord",
                uguid: record.uguid
            });
        };

        const deleteBtn = recordItem.querySelector('.delete-history-item');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({
                command: "deleteRecord",
                uguid: record.uguid
            });
        });

        historyList.insertBefore(recordItem, historyList.firstChild);
    });
    updateRecordCount();
}

function toggleGeneratingState(generating) {
    isGenerating = generating;
    if (generating) {
        sendIcon.classList.add('hidden');
        stopIcon.classList.remove('hidden');
    } else {
        sendIcon.classList.remove('hidden');
        stopIcon.classList.add('hidden');
    }
}

async function sendMessage() {

    if (isGenerating) {
        vscode.postMessage({ command: 'stopResponse' });
        toggleGeneratingState(false);
        removeLoading();
        return;
    }

    const question = questionInput.value.trim();
    if (!question) {
        return;
    }

    toggleGeneratingState(true);

    questionInput.value = '';
    questionInput.style.height = 'auto';
    
    currentAssistantMessage = null;

    const paths = [...includePaths];
    if (currentInclude && isCurrentInclude) {
        const fn = getFileName(currentInclude);
        let path = currentInclude;
        if (fn.lastIndexOf(":") >= 0) {
            path = currentInclude.slice(0, currentInclude.lastIndexOf(":"));
        }
        if (!paths.includes(path)) {
            paths.unshift(path);
        }
    }
    vscode.postMessage({
        command: "chat",
        question,
        paths,
    });
}

// Event listeners
submitBtn.addEventListener('click', sendMessage);

questionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

modelSelector.addEventListener('change', function(e) {
    const selectedModel = e.target.value;
    vscode.postMessage({ command: "selectedModel", selectedModel });
});

function clearChat() {
    const chatContainer = document.getElementById('chatContainer');
    
    while (chatContainer.firstChild) {
        chatContainer.removeChild(chatContainer.firstChild);
    }

    currentAssistantMessage = null;
    questionInput.focus();
    toggleGeneratingState(false);
}

function loadRecord(record) {
    if (record) {
        autoScrollEnabled = true;
        record.messages.forEach(item => {
            if (item.role === 'user') {
                addMessage(item.content, true);
            } else if (item.role === 'assistant') {
                addMessage(item.content, false);
            }
            scrollToBottomIfNecessary();
        });
        questionInput.focus();
    }
}

function showErrorMsg(title, message) {
    const ollamaError = document.getElementById('ollamaError');
    ollamaError.innerHTML = `
        <p class="font-bold">${title}</p>
        <p>${message}</p>
    `;
    ollamaError.classList.remove('hidden');
}

window.addEventListener('message', event => {
    const { command, text, availableModels, selectedModel, records, uguid, include } = event.data;
    
    if (command === "loadRecord" && records) {
        addRecords(records, uguid);
        clearChat();
        loadRecord(records.find(record => record.uguid === uguid));
    } else if (command === "chatResponse") {
        updateLastAssistantMessage(text);
    } else if (command === "ollamaInstallErorr") {
        showErrorMsg("Error: Ollama CLI not installed",
            'Please install Ollama CLI to use this application. Visit <a href="https://ollama.com/download" class="underline" target="_blank" rel="noopener noreferrer">ollama.com</a> for installation instructions.');
        submitBtn.disabled = false;
    } else if (command === "ollamaModelsNotDownloaded") {
        showErrorMsg("Error: Model Not Available", "The configured model is not available. Please download it first or choose a different model.");
        submitBtn.disabled = false;
    } else if (command === "sendMessage") {
        addMessage(text, true);
        showLoading();
    } else if (command === "messageStreamEnded") {
        submitBtn.disabled = false;
        toggleGeneratingState(false);
        currentAssistantMessage = null;
    } else if (command === "newChat") {
        clearChat();
    } else if (command === "showRecords") {
        historyPanel.classList.add('open');
    } else if (command === "updateModelList") {
        populateModelSelector(availableModels, selectedModel);
    } else if (command === "error") {
        showErrorMsg("ERROR", text);
    } else if (command === "setCurrentInclude") {
        setCurrentInclude(text, include);
    } else if (command === "updateInclude") {
        updateIncludePaths(text, true);
    } else if (command === "updateContextNumber") {
        setContextNumber(text);
    }
});

closeHistoryBtn.addEventListener('click', () => {
    historyPanel.classList.remove('open');
    historySearch.value = '';
    filterHistory('');
});
