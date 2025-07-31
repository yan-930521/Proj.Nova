import { z } from 'zod';

import { DynamicStructuredTool } from '@langchain/core/tools';

import { SUBAGENT_REFLECT_TYPE } from '../prompts/task';
import { TaskDescription, TaskType } from '../task/Task';

export const RouterTool = new DynamicStructuredTool({
    name: "router_tool",
    description: "根據使用者輸入，決定需要一般對話、資訊檢索或深度推理。",
    schema: z.object({
        next: z.enum([
            "general_chat",
            "retrieve_information",
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

export const CreateShorttermTask = new DynamicStructuredTool({
    name: "create_shortterm_Task",
    description: "創建短期任務",
    schema: z.object({
        task: z.string()
            .describe("任務的詳細描述、需求、目標。")
    }),
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});

export const MonitorConfigSchema = z.object({
    resources: z.array(
        z.object({
            name: z.string().describe("要監控的資源名稱，為一個變數，例如 \"value\", \"temperature\""),
            check_interval: z.string().describe("檢查資源狀態的時間間隔，例如 '10m', '1h'，單位預設為分鐘"),
            threshold: z.number().optional().describe("單一數值閾值，用於觸發條件"),
            on_below_threshold: z.string().optional().describe("當資源低於 threshold 時觸發的子任務名稱"),
            on_above_threshold: z.string().optional().describe("當資源超過 threshold 時觸發的子任務名稱"),
            min: z.number().optional().describe("資源允許的最小值"),
            max: z.number().optional().describe("資源允許的最大值"),
            on_violation: z.string().optional().describe("當資源超出 min/max 區間時觸發的子任務名稱")
        })
    ).describe("定義所有需監控的資源項目"),
});

const iifePattern = /^\(\s*\(\s*.*\s*\)\s*=>\s*\{[\s\S]*\}\s*\)\s*\(\s*\)\s*;?$/;

export const SubtaskSchema = z.object({
    name: z.string().describe("子任務的名稱"),
    description: z.string().describe("對子任務功能、目標的詳細說明"),
    type: z.enum(["callagent", "jscode"])
        .describe("子任務類型，callagent 表示呼叫代理，jscode 表示執行 js_code"),
    schedule: z.object({
        type: z.enum(["cron", "interval", "threshold-triggered"])
            .describe("排程類型，例如週期性或由資源觸發"),
        trigger: z.string().describe("具體的排程條件，例如 cron 表達式、資源變數名稱")
    }),
    js_code: z.string()
        .optional()
        .describe("執行該子任務所需的 JavaScript 程式碼，最外層必須是(() => { ... })()，type 為 jscode 時必須填寫")
        .refine(val => val == undefined || iifePattern.test(val.trim()), {
            message: "js_code 必須是立即執行箭頭函式 (IIFE)，例如 (() => { ... })()"
        }),
    resource: z.string().optional().describe("此子任務提供的變數名稱（如 'temperature'），若該子任務會回傳資源值，則應提供此欄位")
}).describe("該子任務的排程設定").refine(data => {
    if (data.type === "jscode") return typeof data.js_code === "string" && data.js_code.length > 0;
    return true;
}, {
    message: "當 type 為 jscode 時，js_code 欄位必須存在且符合格式"
});

export const LongTermTaskLLMOutputSchema = z.object({
    name: z.string().describe("長期任務的名稱"),
    monitor_config: MonitorConfigSchema.describe("包含所有資源與狀態的監控設定"),
    subtasks: z.array(SubtaskSchema).describe("所有可執行的子任務清單")
});

export const CreateLongtermTask = new DynamicStructuredTool({
    name: "create_longterm_Task",
    description: "創建長期任務",
    schema: LongTermTaskLLMOutputSchema,
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});


export const FastClassify = new DynamicStructuredTool({
    name: "fast_classify",
    description: `快速分類輸入訊息，判斷用戶意圖類別，分類說明如下: \n${Object.entries(TaskDescription).map(([name, description]) => ` - ${name}: ${description}`)}`,
    schema: z.object({
        intent: z.enum(Object.keys(TaskType) as [keyof typeof TaskType])
            .describe("使用者輸入的意圖分類")
    }),
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});

export const ReflectTool = new DynamicStructuredTool({
    name: "reflect_tool",
    description: "reflect the subtasks",
    schema: SUBAGENT_REFLECT_TYPE,
    func: async (input) => {
        const data = JSON.stringify(input, null, 4);
        return data;
    }
});