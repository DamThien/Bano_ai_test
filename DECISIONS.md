# Decision Notes

## Đã ưu tiên xử lý

- **Validate request** (`src/validation.ts`): kiểm tra `userId` (chuỗi, 1–100 ký tự), `text` (chuỗi, 1–2000 ký tự), và header `Idempotency-Key` bắt buộc phải có. Bất kỳ trường nào sai đều trả về `400 { "error": "INVALID_REQUEST" }` — dùng một error code duy nhất, ổn định, không lộ chi tiết field nào sai (tránh dò cấu trúc input).
- **Idempotency thật sự** (`src/job-service.ts`): trước khi tạo job mới, tra `idempotencyIndex` trong `JobStore` theo key.
  - Nếu key đã tồn tại và fingerprint (hash của `userId + text`) trùng khớp → trả lại job cũ, **không** gọi AI provider lần nữa.
  - Nếu key trùng nhưng fingerprint khác (payload khác) → ném `IdempotencyConflictError`, `app.ts` bắt và trả `409 { "error": "IDEMPOTENCY_KEY_CONFLICT" }`.
  - Trước đây service luôn tạo job mới bất kể key, nên retry của client sinh job trùng — đây là lỗi nghiêm trọng nhất nên xử lý trước.
- **AI provider an toàn**:
  - Thêm `withTimeout()` bọc quanh `aiClient.analyze()` (mặc định 5000ms, có thể override qua `aiTimeoutMs` để test không phải chờ thật). Nếu provider treo, job tự chuyển sang `failed` thay vì kẹt ở `processing` vô thời hạn.
  - Response/API trả cho client luôn là code cố định `AI_PROCESSING_FAILED`, không bao giờ là `error.message` gốc của provider (tránh lộ API key, nội dung lỗi nội bộ...). Message gốc chỉ ghi vào log server-side (`analysis_job_failed`) để debug.
- **Không log raw text**: log `analysis_job_created` trước đây ghi nguyên `text` của user — đã đổi thành `textLength` (số ký tự) để vẫn hữu ích cho debug mà không lưu nội dung nhạy cảm.
- **Malformed JSON body**: thêm error-handling middleware ở cuối `app.ts` để bắt `SyntaxError` từ `express.json()` (body không phải JSON hợp lệ) và trả `400 INVALID_REQUEST` thay vì để lộ HTML error mặc định của Express.
- **Bổ sung 4 test mới** (giữ nguyên 4 test cũ): reused key khác payload → 409; thiếu header → 400; provider treo → job vẫn fail thay vì kẹt mãi; raw text không xuất hiện trong log.

## Chưa xử lý

- Chưa có rate limiting / kích thước request tổng thể (chỉ giới hạn field-level).
- `JobStore` vẫn là in-memory (Map) — dữ liệu mất khi restart, và `idempotencyIndex` không có TTL/eviction nên sẽ phình bộ nhớ theo thời gian nếu chạy lâu.
- Chưa validate kiểu dữ liệu lồng nhau (ví dụ nếu client gửi `userId` là object/array thì đã bị chặn bởi `typeof !== "string"`, nhưng chưa có test riêng cho từng edge case này).
- Chưa có retry/backoff logic có kiểm soát cho AI provider (hiện tại lỗi/timeout là fail thẳng, không retry).
- Chưa có test riêng cho lỗi JSON malformed (middleware đã viết nhưng chưa kịp viết test do giới hạn thời gian).

## Nếu có thêm một ngày

- Thêm persistent store (Redis/Postgres) cho `JobStore` để idempotency và job status sống sót qua restart, đúng tinh thần production.
- Thêm retry có giới hạn (ví dụ 1–2 lần với backoff ngắn) cho lỗi tạm thời của AI provider trước khi đánh dấu `failed`.
- Thêm TTL cho `idempotencyIndex` (ví dụ 24h) để tránh phình bộ nhớ vô hạn.
- Viết thêm test cho malformed JSON, cho `userId`/`text` vượt quá độ dài giới hạn (boundary test tại đúng 100/2000 ký tự).
- Thêm structured logging (pino/winston) với request-id để trace theo từng request thay vì `console.log` thô.

## Trade-off hoặc giả định quan trọng

- Idempotency dùng **fingerprint = sha256(userId + text)** thay vì so sánh toàn bộ payload trực tiếp — nhẹ hơn khi so sánh và tránh giữ lại bản sao dữ liệu nhạy cảm trong index, nhưng có (cực nhỏ) khả năng va chạm hash lý thuyết.
- AI timeout mặc định chọn 5000ms — giả định đây là ngưỡng hợp lý cho API nội bộ; con số thật cần benchmark theo SLA thực tế của AI provider. Đã expose qua `aiTimeoutMs` trong `AppDependencies` để dễ cấu hình/test mà không sửa code service.
- `error.message` gốc từ provider vẫn được ghi vào log server (không gửi cho client) — giả định log nội bộ được kiểm soát truy cập tốt hơn response API công khai. Nếu log cũng bị coi là "external", cần mask thêm ở đây.
- Không đổi cấu trúc thư mục hiện có, chỉ thêm `src/validation.ts` và sửa tối thiểu `app.ts`/`job-service.ts` để giữ diff nhỏ, dễ review trong thời gian giới hạn.
