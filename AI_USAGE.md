# AI Usage

## Công cụ đã sử dụng

- Claude (Anthropic) — dùng để đọc/hiểu codebase ban đầu, đề xuất cách fix cho từng vấn đề nêu trong README, và viết code + test.

## Phần được AI hỗ trợ

- Toàn bộ phần code trong `src/validation.ts` (module validate mới), và các thay đổi trong `src/app.ts`, `src/job-service.ts` (idempotency check, timeout cho AI provider, map lỗi provider sang `AI_PROCESSING_FAILED`, bỏ log raw text) đều do AI viết dựa trên yêu cầu trong `README.md`.
- 4 test mới trong `tests/job-api.test.ts` (409 khi trùng key khác payload, 400 khi thiếu header, job fail khi provider treo, log không chứa raw text) do AI viết.
- Nội dung `DECISIONS.md` do AI soạn dựa trên các thay đổi thực tế đã áp dụng vào code.

## Phần tôi tự kiểm tra lại

- Đã chạy `npm ci`, `npm test`, `npm run typecheck` trên máy — toàn bộ 8 test (4 test gốc + 4 test mới) pass, typecheck không lỗi.
- Đã đọc lại từng file đã sửa để đối chiếu với 3 yêu cầu chính trong README: validate input, idempotency (cùng key+payload → cùng job, không gọi AI lần 2; khác payload → 409), và xử lý AI provider an toàn (không kẹt `processing` vô hạn, không lộ message nội bộ, không log raw `text`).
- Hiểu rõ logic fingerprint (sha256 của `userId + text`) dùng để phát hiện payload trùng/khác cho cùng một `Idempotency-Key`.
- Tự đánh giá và liệt kê rõ trong `DECISIONS.md` những phần chưa kịp làm (persistent store, retry/backoff, rate limiting...) để phản ánh đúng mức độ hoàn thiện thực tế trong 60 phút.
