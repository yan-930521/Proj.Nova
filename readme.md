# Persona-Driven Memory Evolution in Adaptive Task-Processing AI Agents

### 具人格驅動記憶演化的自適應任務處理人工智慧代理系統

## 專案簡介

隨著人工智慧技術快速演進，具備自適應與長期學習能力的智慧代理（AI Agents）在複雜任務處理上展現出強大潛力。<br>
本研究提出一套全新框架 Nova ，整合人格驅動的行為模擬、長期記憶演化機制與自適應任務執行能力，目標是打造可模擬人類個性、動態更新知識，並能高效處理多樣任務的智慧代理系統。<br>

本系統參考並改良下列研究架構：<br>
* 多代理協作系統：Magentic-One ([arXiv:2411.04468](https://arxiv.org/abs/2411.04468))
* 語言代理樹狀搜尋：Language Agent Tree Search ([arXiv:2310.04406](https://arxiv.org/abs/2310.04406))
* 動態記憶機制：Agentic Memory for LLM Agents ([arXiv:2502.12110](https://arxiv.org/abs/2502.12110))

---

## Demo Videos
[![Demo Video](https://img.youtube.com/vi/uVKFufVW7Go/maxresdefault.jpg)](https://www.youtube.com/watch?v=uVKFufVW7Go)

---

## 核心架構

Nova 是一套高度模組化、可擴展的 AI 系統架構，設計目標為打造具人格風格、記憶演化、自動任務規劃與設備控制能力的全能助理代理人系統。<br>
結合人格模擬、長期記憶與動態任務分解機制，使 AI 具備以下能力：

### 1. 人格模擬模組
為 AI 代理注入具體的人格特質，使其行為風格具備一致性，並直接影響決策與互動模式。<br>
舉例來說，外向型代理傾向主動探索與交流，而內向型代理則偏好深度分析與謹慎回應。

### 2. 記憶模組
擁有持續演化的記憶網絡與行為習慣
* **長期記憶**：
  * 採用記憶網路架構，支援動態生成、更新與高效檢索，幫助代理根據過去經驗持續優化知識結構。
  * 支援日誌式記憶，將每日對話總結存檔，強化對話背景理解與延續性。
* **人物記憶**：
  儲存並更新使用者相關資訊，提升個性化互動品質與記憶一致性。
#### 參考架構
* https://github.com/langchain-ai/langgraph-memory/
* https://github.com/agiresearch/A-mem/
* https://github.com/OSU-NLP-Group/HippoRAG/
* https://github.com/MemTensor/MemOS/

### 3. 任務調度模組
實現可彈性組裝與分解的任務調度核心，支援多步驟任務處理、工具鏈串接與代理協作。
支援複合任務規劃與流程拆解，可依任務需求建立臨時代理並委派執行。
* 自動撰寫子任務流程
* 動態呼叫技能模組或外部 API 工具
* 根據回饋進行修正或策略調整
* 未來可擴展至自編輯任務執行程式碼、自我增強學習。

### 模組架構規劃
```
Nova（控制中樞）
├── EventMediator（模組間事件流動中樞）
├── SessionContext (對話、上下文管理)
│
├── Assistant（唯一對話入口）
│   └── PersonaEngine（人格/語調模組）
│   └── SessionContext（上下文管理）
│   └── ExpressionPlanner（語言風格控制）
│
├── TaskOrchestrator（任務規劃與代理生成）
│   └── Planner（任務拆解與流程規劃）
│   └── SkillLibrary（技能模組集，可插拔）
│   └── ToolExecutor（工具調用器）
│
├── MemorySystem（智能記憶代理）
│   └── SemanticMemory（知識網絡）
│   └── EpisodicMemory（事件與互動記錄）
│   └── ProceduralMemory（操作與技能經驗）
│   └── Profile（使用者偏好與習慣）
│
├── DeviceController（虛實設備介接）
└── BehaviorValidator（輸出風險與倫理審查）
```
#### 流程圖
<image src="./asset/Mermaid Chart-2025-07-14-072613.png">

### 3. 自適應任務處理模組

融合多代理協作機制與語言樹狀搜尋技術，可根據任務需求動態規劃執行策略，靈活因應變動情境。<br>
同時代理可使用程式語言即時編寫並調用自訂工具，增強任務解決能力。<br>
> ⚠️ 安全警告
> 本系統中的代理具備讀寫檔案與執行程式碼的能力，在進行測試與開發時請務必使用隔離環境（如容器或沙箱），以避免造成潛在的資安風險或破壞性操作。

---

## 應用場景

此框架可廣泛應用於以下領域：

* **個人助理**：提供個性化、長期互動的任務協助。
* **智慧客服**：根據使用者情境提供對應回應，提升服務體驗。
* **教育輔助**：依據學習者特質與進度客製教學策略。
* **決策支援**：於醫療、金融等高複雜度領域提供高效建議與解決方案。

---

## 參考論文

* [Magentic-One](https://arxiv.org/abs/2411.04468)
* [Language Agent Tree Search](https://arxiv.org/abs/2310.04406)
* [Agentic Memory for LLM Agents](https://arxiv.org/abs/2502.12110)
* [Memory-augmented Query Reconstruction for LLM-based Knowledge Graph Reasoning](https://arxiv.org/abs/2503.05193)
* [HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models](https://arxiv.org/abs/2405.14831)
* [From RAG to Memory: Non-Parametric Continual Learning for Large Language Models](https://arxiv.org/abs/2502.14802)
* [MemOS: A Memory OS for AI System](https://arxiv.org/abs/2507.03724)

---

## 聯絡方式

若有任何問題或建議，歡迎透過 [GitHub Issues](https://github.com/yan-930521/Proj.Nova/issues) 與我聯繫！


## To DO
- [X] 目前的記憶查詢方法還是最原始的RAG + 記憶網路，試著將原本的MemoryNote結構更新為更貼近knowledge graph的方式儲存 ( MemoryGraph )。
- [ ] 擴充人格模型庫，強化行為模擬的細緻程度。
- [ ] 優化多代理協作效能，支援更大規模任務。
- [ ] 增加更完整的任務代理人種類。
- [X] 增加TaskOrchestrator的中斷機制
- [X] 優化TaskOrchestrator的planner機制
- [ ] 允許Nova自行編寫子任務代理人。

### Comments
* 2025/07/14/ 我發現知識圖譜沒有比樹狀記憶好，應該暫緩主系統開發，專心研究MemOS論文中的架構
