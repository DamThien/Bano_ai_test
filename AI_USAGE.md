# AI Usage

## Công cụ đã sử dụng

- Claude (Anthropic) — dùng để đọc/hiểu codebase ban đầu, đề xuất cách fix cho từng vấn đề nêu trong README, và viết code + test.

## Phần được AI hỗ trợ

**Round 1 (fix chính theo yêu cầu README):**
- Toàn bộ phần code trong `src/validation.ts` (module validate mới), và các thay đổi trong `src/app.ts`, `src/job-service.ts` (idempotency check, timeout cho AI provider, map lỗi provider sang `AI_PROCESSING_FAILED`, bỏ log raw text) đều do AI viết dựa trên yêu cầu trong `README.md`.
- 4 test đầu tiên trong `tests/job-api.test.ts` (409 khi trùng key khác payload, 400 khi thiếu header, job fail khi provider treo, log không chứa raw text) do AI viết.

**Round 2 (hoàn thiện thêm, sau khi hỏi AI "cần làm gì để bài test hoàn hảo hơn"):**
- Sửa `src/validation.ts` để `.trim()` trước khi kiểm tra rỗng, chặn thêm case `userId`/`text` chỉ chứa khoảng trắng.
- 5 test bổ sung trong `tests/job-api.test.ts`: 404 cho id không tồn tại, boundary test đúng 100/2000 ký tự (pass) và 101/2001 ký tự (fail), whitespace-only bị từ chối, malformed JSON body trả về 400 ổn định.
- Nội dung `DECISIONS.md` (cả 2 round) do AI soạn dựa trên các thay đổi thực tế đã áp dụng vào code, bao gồm phần giải thích giả định về race condition với Node.js single-thread.

**Round 3 (giải thích lý do vì sao các mục trong "Chưa xử lý" không làm, sau khi thảo luận với AI về việc phân biệt "không làm được" vs "cố tình không làm"):**
- Viết lại mục "Chưa xử lý" trong `DECISIONS.md`, chia thành Nhóm A (làm được về kỹ thuật nhưng cần quyết định business/product nên không tự làm) và Nhóm B (không thể test/verify thật trong sandbox này nên không giả vờ hoàn thành, ví dụ Redis/DB thật). Nội dung do AI viết dựa trên cuộc trao đổi trực tiếp trong quá trình làm bài, không phải suy diễn thêm sau khi nộp.

## Phần tôi tự kiểm tra lại

- Đã chạy `npm ci`, `npm test`, `npm run typecheck` trên máy sau cả 2 round — tổng cộng 13 test (4 test gốc + 9 test AI viết thêm) đều pass, typecheck không lỗi.
- Đã đọc lại từng file đã sửa để đối chiếu với 3 yêu cầu chính trong README: validate input, idempotency (cùng key+payload → cùng job, không gọi AI lần 2; khác payload → 409), và xử lý AI provider an toàn (không kẹt `processing` vô hạn, không lộ message nội bộ, không log raw `text`).
- Hiểu rõ logic fingerprint (sha256 của `userId + text`) dùng để phát hiện payload trùng/khác cho cùng một `Idempotency-Key`.
- Hiểu rõ vì sao check-and-create idempotency an toàn với một Node.js instance đơn (không có `await` xen giữa), và biết giới hạn của giả định này nếu scale ra nhiều instance (đã ghi rõ trong `DECISIONS.md`, không giấu đây là điểm chưa hoàn thiện).
- Tự đánh giá và liệt kê rõ trong `DECISIONS.md` những phần vẫn chưa làm sau cả 2 round (persistent store, retry/backoff, rate limiting, race-condition test tự động...) để phản ánh đúng mức độ hoàn thiện thực tế, không để bài trông "hoàn hảo giả tạo".
