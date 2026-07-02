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
- **Bổ sung 4 test ban đầu** (giữ nguyên 4 test cũ): reused key khác payload → 409; thiếu header → 400; provider treo → job vẫn fail thay vì kẹt mãi; raw text không xuất hiện trong log.
- **Trim whitespace khi validate** (`src/validation.ts`): đổi điều kiện từ `userId.length === 0` sang `userId.trim().length === 0` (tương tự cho `text`) — trước đó `"   "` (chuỗi toàn khoảng trắng) vẫn được coi là hợp lệ vì `length > 0`, dù về ý nghĩa nó tương đương chuỗi rỗng.
- **Bổ sung 5 test round 2** để lấp các khoảng trống review dễ bị soi:
  - `GET /v1/analysis-jobs/:id` với id không tồn tại → 404 (route đã có sẵn nhưng chưa được test).
  - Boundary test: `userId` đúng 100 ký tự và `text` đúng 2000 ký tự → 202 (pass đúng biên).
  - Boundary test: `userId` 101 ký tự và `text` 2001 ký tự → 400 (fail ngay ngoài biên, test riêng từng field).
  - `userId`/`text` chỉ chứa khoảng trắng → 400 (kiểm tra fix trim ở trên).
  - Body JSON không hợp lệ (malformed JSON) → 400 `INVALID_REQUEST` thay vì lỗi mặc định của Express (verify middleware bắt `SyntaxError` đã viết từ round 1).
- Tổng cộng: 13/13 test pass, `tsc --noEmit` không lỗi.

## Chưa xử lý

Chia rõ 2 nhóm lý do — không phải "chưa kịp làm" chung chung, mà là quyết định có chủ đích:

**Nhóm A — làm được về mặt kỹ thuật, nhưng cố tình dừng lại vì cần quyết định ngoài phạm vi kỹ thuật (business/product), làm liều sẽ sai hơn là không làm:**

- **Rate limiting**: code không khó (middleware kiểu `express-rate-limit`), nhưng con số hợp lý (bao nhiêu request/phút/user?) là quyết định sản phẩm, không phải kỹ thuật thuần. Đặt bừa một ngưỡng trong 60 phút có thể chặn nhầm traffic thật hoặc để lọt traffic tấn công — cả hai đều tệ hơn để trống và ghi rõ cần bàn với product/SRE.
- **Retry/backoff cho AI provider**: viết code retry thì nhanh, nhưng cần quyết định retry loại lỗi nào (timeout có nên retry không, hay sẽ làm user chờ lâu hơn?), bao nhiêu lần, cost impact nếu provider tính phí theo request — đây là trade-off nghiệp vụ cần domain owner quyết, không tự đoán trong bài test.
- **Trim trước khi lưu (`userId`/`text`) thay vì chỉ trim để validate**: nếu trim trước khi lưu thì `requestFingerprint` (hash) sẽ thay đổi theo, ảnh hưởng tới hành vi idempotency mà client hiện tại không lường trước (2 request cùng nội dung nhưng khác khoảng trắng đầu/cuối sẽ đổi từ "khác nhau" thành "giống nhau"). Đây là thay đổi hành vi API, không phải bug — cần confirm với người sở hữu spec trước khi đổi.
- **Test race condition đa request đồng thời cùng key**: viết test này được (dùng `Promise.all` gửi song song), nhưng giá trị thấp vì lý do đã đúng về logic (xem phần Trade-off) — với kiến trúc single-instance hiện tại, check-and-create là đồng bộ nên không có race. Viết thêm test chỉ để "trông đầy đủ" mà không chứng minh thêm điều gì mới thì không đáng thời gian trong 60 phút.

**Nhóm B — không thể làm *thật* trong môi trường bài test này, chỉ có thể giả vờ:**

- **Persistent store (Redis/Postgres) cho `JobStore`**: môi trường chạy bài test không có Redis/DB thật để kết nối và test. Nếu viết code kết nối tới một connection string tưởng tượng thì không chạy được, không test được — tức là **giả vờ hoàn thành** một tính năng không thể verify, còn tệ hơn để trống và nêu rõ đây là việc cần làm tiếp khi có infra thật.
- **TTL/eviction cho `idempotencyIndex`**: tương tự — cần store có TTL thật (Redis) để có ý nghĩa; làm bằng `setTimeout` trong Map in-memory chỉ là mô phỏng cho vui, không phản ánh đúng hành vi production.
- `JobStore` in-memory nói chung: giữ nguyên vì đổi sang store thật đòi hỏi thay đổi lớn hơn phạm vi 60 phút và không thể test end-to-end trong sandbox này.

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
- **Idempotency check và Node.js event loop**: `createJob()` kiểm tra `idempotencyIndex` và ghi job mới hoàn toàn đồng bộ (không có `await` nào ở giữa), nên trong một tiến trình Node duy nhất sẽ không có 2 request "chen" vào giữa lúc check và lúc ghi. Đây là giả định đúng cho kiến trúc hiện tại (single instance, in-memory store); nếu sau này scale ra nhiều instance/process (ví dụ chạy nhiều pod phía sau load balancer), giả định này sẽ không còn đúng và cần chuyển sang store có hỗ trợ atomic check-and-set thật (Redis `SETNX`, unique constraint ở DB...).
