# BANO Backend Reliability Assessment

**Thời gian:** 60 phút kể từ giờ bắt đầu đã xác nhận.  
**Stack:** Node.js, TypeScript, Express, Vitest.  
**Mục tiêu:** Đánh giá khả năng đọc code, ưu tiên rủi ro và đưa một API đang chạy về trạng thái đáng tin cậy hơn.

## Bối cảnh

API nhận yêu cầu phân tích nội dung bằng AI và trả về một job bất đồng bộ. Code hiện tại chạy được nhưng chưa đủ an toàn để đưa vào production.

```text
POST /v1/analysis-jobs
GET  /v1/analysis-jobs/:id
```

Một số tình huống đang xảy ra:

- Client retry làm phát sinh job trùng.
- Payload không hợp lệ vẫn được nhận.
- AI provider có thể lỗi hoặc treo lâu.
- Log và error response có nguy cơ lộ dữ liệu người dùng hoặc thông tin nội bộ.
- Test coverage chưa đủ cho các luồng rủi ro.

## Yêu cầu

Trong 60 phút, hãy ưu tiên xử lý các nội dung sau:

1. Validate request của `POST /v1/analysis-jobs`.
   - `userId`: chuỗi không rỗng, tối đa 100 ký tự.
   - `text`: chuỗi không rỗng, tối đa 2.000 ký tự.
   - Header `Idempotency-Key`: bắt buộc.
   - Request không hợp lệ trả về HTTP `400` với error code ổn định.
2. Bảo đảm idempotency.
   - Cùng `Idempotency-Key` và cùng payload phải trả lại cùng một job.
   - Không gọi AI provider lần thứ hai.
   - Cùng key nhưng payload khác nên trả về HTTP `409`.
3. Xử lý AI provider an toàn.
   - Job không được nằm ở trạng thái `processing` vô thời hạn.
   - Error trả cho client không làm lộ message nội bộ của provider.
   - Không ghi raw `text` của người dùng vào log.
4. Giữ các test hiện có và bổ sung **ít nhất hai test có ý nghĩa**.
5. Hoàn thiện `DECISIONS.md` và `AI_USAGE.md`.

## Cách chạy

Yêu cầu Node.js 20 trở lên.

```bash
npm ci
npm test
npm run typecheck
```

Chạy server thủ công:

```bash
npm run dev
```

## Quy định

- Được dùng AI, Google và tài liệu kỹ thuật.
- Không được nhờ người khác trực tiếp làm bài.
- Không xóa, skip hoặc sửa test hiện có chỉ để làm test pass.
- Có thể thay đổi cấu trúc code nếu giải thích được lý do.
- Không bắt buộc hoàn thành toàn bộ. Chúng tôi đánh giá cả cách ưu tiên và phần chưa làm.
- Nếu gặp lỗi môi trường, hãy báo trong 10 phút đầu.

## Nộp bài

Nộp toàn bộ source code, gồm:

- Code đã chỉnh sửa.
- Test đã bổ sung.
- `DECISIONS.md`.
- `AI_USAGE.md`.

Không gửi `node_modules`.
