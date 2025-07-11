# Persona-Driven Memory Evolution in Adaptive Task-Processing AI Agents

### 具人格驅動記憶演化的自適應任務處理人工智慧代理系統

## 專案簡介

隨著人工智慧技術快速演進，具備自適應與長期學習能力的智慧代理（AI Agents）在複雜任務處理上展現出強大潛力。<br>
本研究提出一套全新框架，整合人格驅動的行為模擬、長期記憶演化機制與自適應任務執行能力，目標是打造可模擬人類個性、動態更新知識，並能高效處理多樣任務的智慧代理系統。<br>

本系統參考並改良下列研究架構：<br>
* 多代理協作系統：Magentic-One ([arXiv:2411.04468](https://arxiv.org/abs/2411.04468))
* 語言代理樹狀搜尋：Language Agent Tree Search ([arXiv:2310.04406](https://arxiv.org/abs/2310.04406))
* 動態記憶機制：Agentic Memory for LLM Agents ([arXiv:2502.12110](https://arxiv.org/abs/2502.12110))

---

## Demo Videos
[![Demo Video](https://img.youtube.com/vi/uVKFufVW7Go/maxresdefault.jpg)](https://www.youtube.com/watch?v=uVKFufVW7Go)

---

## 核心架構

本專案由三大核心模組構成，彼此協同運作，以實現個性化行為與記憶演化的深度整合：

### 1. 人格模擬模組

為 AI 代理注入具體的人格特質，使其行為風格具備一致性，並直接影響決策與互動模式。<br>
舉例來說，外向型代理傾向主動探索與交流，而內向型代理則偏好深度分析與謹慎回應。

### 2. 記憶模組

* **長期記憶**：
  * 採用記憶網路架構，支援動態生成、更新與高效檢索，幫助代理根據過去經驗持續優化知識結構。
  * 支援日誌式記憶，將每日對話總結存檔，強化對話背景理解與延續性。
* **人物記憶**：
  儲存並更新使用者相關資訊，提升個性化互動品質與記憶一致性。

### 3. 自適應任務處理模組

融合多代理協作機制與語言樹狀搜尋技術，可根據任務需求動態規劃執行策略，靈活因應變動情境。<br>
同時代理可使用程式語言即時編寫並調用自訂工具，增強任務解決能力。
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

## 參考文獻

* [Magentic-One](https://arxiv.org/abs/2411.04468)
* [Language Agent Tree Search](https://arxiv.org/abs/2310.04406)
* [Agentic Memory for LLM Agents](https://arxiv.org/abs/2502.12110)
* [Memory-augmented Query Reconstruction for LLM-based Knowledge Graph Reasoning](https://arxiv.org/abs/2503.05193)

---

## 聯絡方式

若有任何問題或建議，歡迎透過 [GitHub Issues](https://github.com/yan-930521/Proj.Nova/issues) 與我聯繫！


## To DO
- [ ] 目前的記憶查詢方法還是最原始的RAG + 記憶網路，試著將原本的MemoryNote結構更新為更貼近knowledge graph的方式儲存。
- [ ] 增加更多人格模型，強化行為模擬的細緻程度。
- [ ] 優化多代理協作效能，支援更大規模任務。
- [ ] 增加更完整的任務代理人種類。
- [ ] 允許TaskOrchestrator自行編寫子任務代理人。
