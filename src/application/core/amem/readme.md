參考 https://github.com/langchain-ai/langgraph-memory/

參考 https://github.com/agiresearch/A-mem/
MemorySystem
│
├─ UserProfile (Profile)
│   ├─ 基本資訊（名稱、偏好、目標、狀態等）
│   └─ 即時狀態（當前任務、上下文、設定）
│
└─ MemoryNotes (Collection)
    ├─ Semantic Notes (語意記憶)
    │   ├─ 事實、知識點
    │   └─ 相關標籤、描述、嵌入向量
    ├─ Episodic Notes (情節記憶)
    │   ├─ 過去經驗、對話片段
    │   └─ 時間戳、上下文連結
    └─ Procedural Notes (程序記憶)
        ├─ 系統行為規則、核心人格
        └─ 回應模式、操作流程