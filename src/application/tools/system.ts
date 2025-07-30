import { z } from 'zod';

import { DynamicStructuredTool } from '@langchain/core/tools';

export const RouterTool = new DynamicStructuredTool({
    name: "router_tool",
    description: "根據使用者輸入，決定是否需要一般對話、資訊檢索、深度推理。",
    schema: z.object({
        next: z.enum([
            "general_chat",
            "retrieve_memory",
            "deep_think"
        ])
    }),
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});

export const RetrieveTool = new DynamicStructuredTool({
    name: "retrieve_tool",
    description: "Retrieves relevant information from internal memory or the web based on a query string.",
    schema: z.object({
        query: z.string().describe(`The query string to search for relevant information in memory or on the web.`)
    }),
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});


export const ReasoningOutputTool = new DynamicStructuredTool({
    name: "reasoning_tool",
    description: "從第一人稱視角深入思考目前情境，產生連貫且具人性的內在推理過程。",
    schema: z.object({
        reasoning: z.string().describe(`請從第一人稱視角，模擬一位普通人在現實生活中接收到輸入訊息時，所展開的完整內在思考過程。這段推理應自然且流暢，像是內心自語的形式，反映出一個人試圖理解對方語氣、動機、情緒與隱含訊息時會經歷的認知歷程。\n\n請務必讓推理內容具備下列特徵:\n1. **逐步展開的思緒**，包含不確定、懷疑、自我修正與嘗試理解對方的過程。\n2. **情感與直覺反應**，如困惑、懷疑、興奮、懷念等，而不只是理性判斷。\n3. **與自身經驗連結**，例如過去的記憶、情緒、感覺、習慣或價值觀。\n4. **篇幅足夠長（不少於 300 字）**，避免簡化為單句回應或明確結論。\n5. **避免任何工具決策或任務判斷**，這段推理並不涉及任何是否要執行任務或工具呼叫的選擇，它只是單純地模擬「如果我是對方，會怎麼思考」。\n\n這段推理應該要讓閱讀者感受到，這是一個活生生的人的腦中活動，而不是程式化的輸出。`)
    }),
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});

export const ResponseOutputTool = new DynamicStructuredTool({
    name: "response_tool",
    description: "Generate a response in the tone of a text message",
    schema: z.object({
        response: z.string()
            .describe("Generate a response in the tone of a text message")
    }),
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});

export const CreateTask = new DynamicStructuredTool({
    name: "create_task",
    description: "創建新任務",
    schema: z.object({
        task: z.string()
            .describe("任務的詳細描述、需求、目標。")
    }),
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});


export const FastClassify = new DynamicStructuredTool({
    name: "fast_classify",
    description: `快速分類輸入訊息，判斷用戶意圖類別，分類說明如下: \n- chitchat: 日常閒聊與情感互動，如打招呼、閒談等。\n- command: 明確系統指令，需直接執行單步驟操作，如開啟應用、關閉程序。\n- task: 複合任務，需拆解多步驟或多模組協作，如整理會議紀錄並發送郵件。\n- reflection: 自我反思相關詢問或報告生成，如要求評估今日表現。\n- uncertain: 無法判定意圖，需進一步語意分析。`,
    schema: z.object({
        intent: z.enum(["chitchat", "command", "task", "reflection", "uncertain"])
            .describe("使用者輸入的意圖分類")
    }),
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});