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
- Code Generate<br>
  [![Code Generate](https://img.youtube.com/vi/uVKFufVW7Go/hqdefault.jpg)](https://www.youtube.com/watch?v=uVKFufVW7Go)
- Memory Tree, Fast Respond Mode, Task Solve <br>
  [![Memory Tree, Task Solve](https://img.youtube.com/vi/5lXqn00GJRI/hqdefault.jpg)](https://www.youtube.com/watch?v=5lXqn00GJRI)

---

## 核心架構

Nova 是一套高度模組化、可擴展的 AI 系統架構，設計目標為打造具人格風格、記憶演化、自動任務規劃與設備控制能力的全能助理代理人系統。<br>
結合人格模擬、長期記憶與動態任務分解機制，使 AI 具備以下能力：

### 1. 人格模擬模組
為 AI 代理注入具體的人格特質，使其行為風格具備一致性，並間接影響決策與互動模式。<br>
舉例來說，外向型代理傾向主動探索與交流，而內向型代理則偏好深度分析與謹慎回應。

### 2. 記憶模組
擁有持續演化的記憶網絡與行為習慣
* **長期記憶**：
  * 採用Memory Tree架構，支援動態生成、更新與高效檢索，幫助代理根據過去經驗持續優化知識結構。
  * 支援日誌式記憶，將每日對話總結存檔，強化對話背景理解與延續性。
* **人物記憶**：
  儲存並更新使用者相關資訊，提升個性化互動品質與記憶一致性。
#### 參考架構
* https://github.com/langchain-ai/langgraph-memory/
* https://github.com/agiresearch/A-mem/
* https://github.com/OSU-NLP-Group/HippoRAG/
* https://github.com/MemTensor/MemOS/

### 3. 自適應任務調度模組

實現可彈性組裝與分解的任務調度核心，支援多步驟任務處理、工具鏈串接與代理協作。可根據目標拆解為短期任務或長期任務，並自動追蹤進度與資源狀態。

#### 核心功能

- **複合任務規劃與流程拆解**
  - 支援多層級子任務（Subtask）與條件式流程。
  - 長期任務（LongTask）支援監控與重試機制。

- **資源監控與條件觸發**
  - 內建 `MonitorConfig`，可設定：
    - 檢查間隔（如：`10m`）
    - 數值閾值（高於 / 低於）
    - 最大最小允許範圍（`min`/`max`）
    - 違規時自動執行指定子任務

- **四種任務排程機制**
  - `cron`：定時排程
  - `interval`：週期性執行
  - `event-driven`：基於外部事件觸發
  - `threshold-triggered`：資源條件違規自動觸發

- **自動撰寫與修正子任務流程**
  - 使用 LLM 拆解任務描述並產生子任務流程。
  - 根據子任務結果進行反饋與策略調整。

- **技能模組與工具鏈整合**
  - 支援多種工具調用（檔案處理、網路請求、語意分析等）。
  - 可將工具委派給不同代理執行。

- **腳本生成與執行（安全沙箱）**
  - 子任務可動態生成腳本並在沙箱中執行。
  - 使用 [isolated-vm](https://github.com/laverdet/isolated-vm) 實現資源與效能隔離，避免主系統被危險程式碼影響。

#### ⚠️ 安全警告

> 本系統中的代理具備讀寫檔案與執行程式碼的能力，在進行測試與開發時請務必使用隔離環境（如容器或沙箱），以避免造成潛在的資安風險或破壞性操作。  
> 本系統使用之沙箱為：`isolated-vm`（Node.js 執行環境的低階虛擬機機制）。


### 模組架構規劃
```
Nova（控制中樞）
├── EventMediator（模組間事件流動中樞）
├── SessionContext (對話、上下文管理)
├── UserIO (對話入口)
├── Persona（人格模組）
│   ├── handleChat() 對話處理入口
│   └── Routing
│       ├── Chat
│       ├── Reasoning
│       ├── Retrieval
│       └── Diary
├── TaskOrchestrator（任務調度器）
│   ├── handleTask() 任務建立與儲存
│   ├── processTask() 任務主流程執行器
│   │   ├── decomposeTask() 任務拆解
│   │   ├── subAgent.processTasks() 子任務處理器
│   │   └── prepareFinalAnswer() 整理最終報告
│   ├── SubAgent 任務子代理執行單位
│   ├── TaskTemplate 任務模板
│   └── SkillLibrary  可插拔技能模組（由 SubAgent 使用）
│
├── MemorySystem（記憶系統）
│
├── DeviceController（虛實設備介接）
└── BehaviorValidator（輸出風險與倫理審查）
```
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/yan-930521/Proj.Nova)

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
- [X] 增加TaskOrchestrator的中斷機制
- [X] 優化TaskOrchestrator的planner機制
- [X] 增加Assistant多模態能力
- [ ] 擴充人格模型庫，強化行為模擬的細緻程度。
- [ ] 優化多代理協作效能，支援更大規模任務。
- [ ] 重構 TaskOrchestrator ，`.\src\application\task\task.md` 內的task agent待實作
  - [ ] 自行編寫 支援特定子任務的task agent。

### Comments
* 2025/07/14
  - 我發現知識圖譜在對話情境記憶沒有比樹狀記憶高效，應該暫緩主系統開發，專心研究MemOS論文中的架構
  - 記憶是全域的還是按照人格分類? 或者全域 然後限制存取?
* 2025/07/19 
  - 初步完善參考memos的memory系統，開始重構TaskOrchestrator
* 2025/07/20
  - 對記憶系統的操作API應該要完善
  - 對於提高響應速度方面，可以採用"Respond First, Expand Later"
    從短期記憶檢索，回應，並在後續對話擴展上去
* 2025/07/21
  - TaskOrchestrator目前的子任務代理人是固定的，每一位代理人只能負責特定一種任務
    改成sub task agent，然後存取所有工具或許比較好
  - 大幅改善assistant token用量<br>
    <image src="./asset/token.png" height="200">
* 2025/07/30
  - 重新規劃assistant邏輯、重命名assistant為persona
  - 構想，在 Nova 新增一個訊息總匯的管道，所有AI都會將訊息發佈至管道 讓 Nova 進行統合
