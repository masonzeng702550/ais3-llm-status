# AIS3 LLM Status

AIS3 大型語言模型服務（`llm-api.zoolab.org` / `llm.zoolab.org`）的狀態頁。
每 30 秒從外部對每個模型送出一次真實推論請求，記錄可用性與延遲，並以純靜態網站呈現。

> 這是外部黑箱監測，不是 AIS3 官方公告管道。

## 運作方式

```
GitHub Actions (排程每 5 分鐘啟動，job 內每 30 秒一輪)
  └─ scripts/probe.ts ──► llm-api.zoolab.org
                          llm.zoolab.org
       └─ 判定狀態、更新彙總 ──► 每輪 commit 到 `data` 分支
                                      │
                                      ▼  raw.githubusercontent (CORS 開放)
                              瀏覽器每 20 秒抓取最新資料

GitHub Actions (push / 每日)
  └─ astro build（烘焙當下快照 + 事件公告）──► GitHub Pages
```

GitHub Actions 的 cron 最短只能到 5 分鐘，所以排程只負責「啟動」，實際探測是在單一 job
內部迴圈：每 30 秒一輪、每輪結束就 commit。這同時繞過了 cron 本身的延遲抖動。

探測資料寫入獨立的 `data` 分支，**不會觸發網站重新建置**。GitHub Pages 的建置有每小時
約 10 次的軟性上限，靠部署來更新資料會直接撞上；改由瀏覽器端讀取資料分支後，網站只在
程式碼或事件公告變動時才重建。

首頁長條圖每格代表**一分鐘**（2 次探測），共 90 格，約一個半小時填滿。

首屏使用建置時烘焙的快照，因此關閉 JavaScript 仍可看到狀態，載入後再由前端更新為最新值。

## 監測項目

| 群組 | 元件 |
| --- | --- |
| LLM API | Llama 3.1 8B、Llama Guard 3 8B、Gemma 4 12B / 26B、Nemotron Cascade 2 30B、Llama 3.3 70B、Nemotron 3 Ultra 550B |
| 平台 | API Gateway（`/v1/models`）、Web Chat UI |

每次探測記錄總延遲、首個 token 時間（TTFT）、HTTP 狀態碼與錯誤分類。
**模型回應內容永遠不會被寫入資料**，只保留「是否有回應」的布林判定。

> 探測頻率是 [`config/monitors.yml`](config/monitors.yml) 的 `probe.intervalSeconds`。
> 這是控制上游負載的唯一旋鈕：30 秒約等於每天 26,000 次請求。

判定規則與延遲門檻集中定義在 [`config/monitors.yml`](config/monitors.yml)，
網站與探測腳本共用同一份設定。

## 開發

```bash
npm install
cp .env.example .env   # 填入 AIS3_API_KEY
npm run dev
```

沒有 `.data/` 目錄時，網站會顯示「尚未有探測資料」而不是假的正常狀態。
要在本機產生資料：

```bash
npm run probe -- --data .data/data
```

加上 `--dry` 只探測不寫檔，適合驗證設定：

```bash
node --import tsx --env-file=.env scripts/probe.ts --dry
```

## 發布事件公告

在 `src/content/incidents/` 新增 Markdown 檔（檔名即網址 slug）：

```markdown
---
title: 70B 模型大量逾時
type: incident          # incident | maintenance
severity: major         # minor | major | critical | maintenance
affected: [llama-3.3-70b]
startedAt: 2026-07-26T15:00:00+08:00
resolvedAt: 2026-07-26T17:12:00+08:00   # 未結束則省略
updates:
  - at: 2026-07-26T15:10:00+08:00
    status: investigating
    body: 監測到 70B 模型持續回傳 504，正在確認後端節點狀態。
---

## 事後檢討

（自由 Markdown 內容）
```

`affected` 內的 id 必須存在於 `config/monitors.yml`，否則建置會直接失敗——
避免打錯字讓公告默默對應不到任何元件。

`type: maintenance` 且時間落在視窗內時，該元件狀態會被覆寫為「維護中」，
且不計入可用率統計。

推送到 `main` 後會自動重新部署。

## 公開資料

所有量測結果都是公開的靜態 JSON，可直接取用：

| 檔案 | 內容 |
| --- | --- |
| `status.json` | 目前狀態快照 |
| `minutes.json` | 首頁長條圖用的每分鐘統計（近 90 分鐘） |
| `summary.json` | 近 90 天每日彙總 |
| `daily/YYYY-MM.json` | 每月的每日彙總，永久保留 |
| `raw/YYYY-MM-DD.jsonl` | 原始探測紀錄，保留 7 天 |
| `badges/<元件>.svg` | 狀態徽章 |

基底路徑：`https://raw.githubusercontent.com/masonzeng702550/ais3-llm-status/data/data/`

`schemaVersion` 是相容性的唯一依據，欄位只增不減。

## 設定

需要在 repository secrets 設定：

| Secret | 用途 | 必要 |
| --- | --- | --- |
| `AIS3_API_KEY` | 探測用 API key | 是 |
| `ALERT_WEBHOOK_URL` | Discord / Slack 狀態變更通知 | 否 |

Pages 來源需設為 **GitHub Actions**（Settings → Pages → Source）。

## 授權

程式碼採 MIT，量測資料採 CC BY 4.0。
