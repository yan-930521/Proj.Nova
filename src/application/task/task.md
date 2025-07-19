# to do

### **TextAgent** – 負責各種文字相關的處理任務

* **rewriter** – 語意不變情況下改寫句子或段落
* **summarizer** – 長文濃縮成短摘要或條列式重點
* **translator** – 多語言翻譯，遵守原始語言格式與語序
* **editor** – 拼寫與文法錯誤修正、句子簡化或擴充
* **template\_writer** – 根據指定格式撰寫模板類文字（如履歷、報告）

---

### **DocParserAgent** – 處理 PDF、Excel 等文件結構與內容

* **pdf\_parser** – 將 PDF 拆解為可讀文本與分段結構
* **excel\_extractor** – 抽取 Excel 表格資料，補齊標題與欄位
* **doc\_splitter** – 將文件依標題或段落分頁重組
* **doc\_metadata\_reader** – 抽取文件標題、作者、時間等元資料

---

### **WebSearchAgent** – 上網搜尋、閱讀與摘要外部網頁

* **google\_search** – 使用搜尋引擎 API 查找特定主題資料
* **site\_scraper** – 讀取網頁內容並自動濃縮重點
* **news\_tracker** – 持續追蹤特定主題的新聞或文章來源
* **web\_alert** – 網頁有更新時觸發通知或重新摘要

---

### **ResearchAgent** – 整合與分析多筆資料的研究任務

* **multi\_source\_merger** – 整合多個來源的相同主題資訊
* **conflict\_resolver** – 當來源不一致時進行矛盾對比與解析
* **theme\_organizer** – 將資訊分類為多主題，建立脈絡圖譜

---

### **DataAnalysisAgent** – 處理結構化資料並產出可視化

* **table\_statistician** – 基本統計運算：平均、總和、分組
* **data\_cleaner** – 補值、格式統一、移除異常值
* **chart\_generator** – 自動生成折線圖、長條圖、圓餅圖
* **query\_executor** – 對表格資料執行 SQL 查詢

---

### **CodeAgent** – 協助寫程式、除錯與解釋

* **code\_generator** – 根據需求自動產生程式碼
* **bug\_detector** – 自動發現常見邏輯與語法錯誤
* **test\_writer** – 產生單元測試與測試案例說明
* **code\_explainer** – 逐行解釋複雜程式邏輯或結構

---

### **MemoryAgent** – 管理使用者相關記憶與推論

* **semantic\_retriever** – 根據語意檢索過去記憶或知識片段
* **memory\_summarizer** – 將多段記憶整理成一段摘要記憶
* **tag\_inferencer** – 根據內容自動推論標籤與記憶分類

---

### **StrategyAgent** – 協助分析市場與設計決策策略

* **backtester** – 使用歷史數據回測策略有效性
* **signal\_builder** – 建立技術指標或交易入場信號
* **risk\_assessor** – 風險/報酬比、最大虧損分析與建議

---

### **VisionAgent** – 圖像分類與處理

* **image\_classifier** – 辨識圖片中的類別或主題
* **ocr\_reader** – 擷取圖片中的文字內容
* **image\_captioner** – 自動為圖片產生標題或描述
* **face\_analyzer** – 偵測臉部特徵與表情（如情緒、年齡）

---

### **VoiceAgent** – 處理語音輸入與輸出

* **speech\_to\_text** – 將語音轉為文字
* **text\_to\_speech** – 將回應轉成語音播放
* **voice\_command\_parser** – 解讀語音指令並拆解意圖

---

### **VideoAgent** – 處理影片資訊與語音

* **video\_timeline\_summarizer** – 把影片依時間軸摘要成重點片段
* **scene\_splitter** – 自動偵測場景並斷開分段
* **audio\_transcriber** – 擷取影片中的語音並加上時間戳

---

### **AutomationAgent** – 支援自動化流程與 API 互動

* **task\_scheduler** – 排定任務自動執行時間與頻率
* **api\_caller** – 呼叫外部 REST API 執行任務
* **webhook\_responder** – 接收 webhook 並觸發自定邏輯
