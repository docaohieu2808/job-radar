# Job Radar: các quyết định thiết kế và lý do

Tài liệu này để đọc trước khi kể về Job Radar trong buổi phỏng vấn. Mỗi mục ghi: đã chọn gì, vì sao, và đã đo được gì. Số liệu đều đo trên hệ thống thật (tháng 10/2026).

## 1. Bài toán

Tìm tin tuyển DevOps ở TP.HCM mà không phải lướt tay từng job board mỗi ngày. Có ba cái khó:

- Cùng một tin xuất hiện ở nhiều nơi.
- Nhiều tin không có trên job board, chỉ đăng trên trang tuyển dụng riêng của công ty.
- Phần lớn tin không hợp: sai cấp, sai stack, ở Hà Nội.

Job Radar gom tin từ mọi nguồn, gộp các tin trùng, chấm điểm theo tiêu chí của tôi, rồi đưa ra một hộp thư để xử lý mỗi ngày.

## 2. Vì sao thử Cloudflare Workers trước, rồi chuyển sang tự host

- **Định làm:** chạy hết trên Cloudflare Workers (Cron, Queues, D1), vì không phải lo server.
- **Đo trước khi làm (phase 0):**
  - Parse một trang tốn 30–80 ms CPU, trong khi gói Free chỉ cho 10 ms mỗi lần chạy.
  - LinkedIn trả 429 cho IP của Cloudflare ngay từ request đầu tiên.
- **Quyết định:** chuyển sang một node ARM sẵn có (Oracle Cloud), chạy Docker Compose.
  - Không còn trần CPU.
  - LinkedIn đọc được.
  - Không tốn thêm tiền.
  - Tất cả nằm trên một node, không tách đôi app.
- **Bài học để kể:** đo trước rồi mới chọn nền tảng. Serverless không hợp với crawler (CPU parse, IP bị chặn).

## 3. Hàng đợi (frontier) bằng Postgres, không dùng Kafka hay Redis

- Mỗi việc là một dòng trong bảng `crawl_queue`. Worker lấy việc bằng `SELECT … FOR UPDATE SKIP LOCKED`: nhiều worker chạy song song mà không giành cùng một dòng, cũng không phải chờ nhau.
- **Politeness:** khoá luôn dòng của host trong cùng transaction, rồi đẩy `next_allowed_at` của host đó lên. Nhờ vậy:
  - không bao giờ có hai request cùng lúc tới một host;
  - mỗi host có khoảng nghỉ riêng (LinkedIn 5 phút, job board 20 giây, site công ty 30 giây).
- **Vì sao không dùng Kafka:**
  - Quy mô là vài ngàn host, vài ngàn trang mỗi ngày.
  - Postgres vốn đã cần để lưu tin.
  - Thêm Kafka thì phải vận hành thêm một hệ thống, mà ở mức tải này không được gì.
- **Khi nào mới cần đổi:** khi lên hàng triệu URL mỗi ngày, hoặc nhiều node crawl cùng lúc. Lúc đó tách frontier ra Redis/Kafka như chương 9 mô tả.

## 4. Bị chặn thì làm gì (429/403)

- Gặp 429 thì dừng host đó 15 phút, mỗi lần bị từ chối liên tiếp thì gấp đôi, tối đa 6 giờ. Host trả lời bình thường thì tính lại từ đầu. Host có gửi `Retry-After` thì làm theo.
- Việc bị từ chối không bị trừ lượt thử: lỗi là do host, không phải do việc.
- **Đo được:** LinkedIn guest với khoảng cách 90 giây thì tới khoảng request thứ 8 là bị 429. Nên LinkedIn chạy 5 phút một request, tối đa 100 tin chi tiết mỗi ngày.
- Màn Sources có nút "Try now": gọi thử thật một lần, host đã mở thì gỡ dừng ngay.

## 5. Không đọc lại thứ đã biết ("URL seen" và "content seen")

- **URL seen:**
  - Khoá `(source, external_id)` của tin đã lưu.
  - Bảng `rejected_postings` cho các tin đã đọc nhưng bỏ (sai tên vị trí, sai nơi làm). Trang tìm kiếm liệt kê lại tin đó thì crawler không mở lại.
  - Nhớ 30 ngày, vì sở thích có thể đổi.
- **Content seen:**
  - Băm SHA-256 phần nội dung chính của trang tuyển dụng (đã bỏ menu, header, footer).
  - Hash không đổi thì không parse lại, và lần kiểm sau giãn gấp đôi (từ 1 ngày tới tối đa 7 ngày).
  - Trang hay đổi được kiểm dày, trang im lìm được kiểm thưa.
- **Gộp tin trùng giữa các nguồn:** dùng khoá "tên công ty + chức danh" đã chuẩn hoá (bỏ dấu, bỏ "Công ty TNHH", "JSC"...). Không dùng hash nội dung để gộp, vì mỗi job board viết JD hơi khác nhau.

## 6. Danh bạ công ty tự lớn, rồi đi tìm trang tuyển dụng

- **Nguồn công ty:**
  1. công ty xuất hiện trong các tin đã crawl;
  2. danh bạ công ty TP.HCM của TopDev (khoảng 2.400 công ty, 92% có website).
- **Nguồn website, theo thứ tự tin cậy:**
  1. tôi nhập tay;
  2. TopDev;
  3. phần giới thiệu công ty trên VietnamWorks;
  4. email liên hệ trong JD, chỉ khi tên miền giống tên công ty (ví dụ `@tinhvan.com` cho Tinh Vân; email của công ty headhunt thì bỏ).
- **Tìm trang tuyển dụng:**
  - Đọc trang chủ, tìm link có chữ "Tuyển dụng", "Careers", "Jobs".
  - Không thấy thì thử các đường dẫn quen như `/careers`, `/tuyen-dung`.
  - Link trỏ tới ATS (Greenhouse, Lever, Workday, SmartRecruiters) thì đọc thẳng API JSON của ATS.
- **Tôn trọng robots.txt** trên mọi site công ty, cache một tuần.
- **Trang chỉ là vỏ JavaScript:** đánh dấu "needs a browser" và đếm. Chỉ thêm trình duyệt headless khi số đếm cho thấy đáng làm.

## 7. Độ chính xác: lọc tin thật khỏi trang dịch vụ

- **Lỗi đã gặp:** lượt đầu, khoảng 2/3 "tin" lấy từ trang công ty là trang giới thiệu dịch vụ, như "Cloud & DevOps Services" hay "Infrastructure Advisory".
- **Cách sửa:**
  - Chữ trên link phải chứa từ chỉ vị trí, nguyên từ (engineer, kỹ sư, chuyên viên, lead...). "Engineering" thì không tính.
  - Bỏ các đường dẫn kiểu `/services`, `/solutions`, `/dich-vu`.
  - Trang mở ra phải có ít nhất 2 dấu hiệu của một tin tuyển dụng: yêu cầu, quyền lợi, mô tả công việc, ứng tuyển...
- **Kiểm tay 20 tin từ job board:** 3 trường bị sai.
  - "2–5+ years" bị đọc thành 5 năm.
  - Số năm lấy nhầm từ đoạn giới thiệu công ty.
  - TopDev ghi "1 year, 3 years" nhưng bị hiểu thành junior.
  
  Đã sửa cả ba và thêm test cho từng lỗi.
- **Mỗi trường đã trích đều lưu kèm câu gốc**, để kiểm lại trên màn hình.

## 8. Chấm điểm minh bạch thay vì để AI chấm

- Điểm 0–100 bắt đầu từ 50, cộng trừ theo luật. Mỗi điểm cộng/trừ có lý do và thuộc một nhóm: lương, stack, cấp, tiếng Anh, đãi ngộ, hình thức làm việc.
- Trọng số từng nhóm chỉnh được trên màn Settings. Màn đó dùng đúng công thức với server, nên điểm xem trước khớp với điểm thật. Lưu thì server chấm lại mọi tin.
- **Vì sao không để LLM chấm:**
  - điểm phải giải thích được;
  - phải ổn định giữa các lần chạy;
  - không tốn tiền.
- LLM chỉ dùng cho một việc hẹp: đọc trang tuyển dụng liệt kê tin mà không có link. Giới hạn 200 lần mỗi ngày.

## 9. Giao diện

- Vẽ bằng Claude Design. Bản export là CSS thuần cộng một prototype React, nên dựng bằng React + Vite, giữ nguyên style của bản vẽ.
- Không dùng Next.js: một người dùng, chạy trong tailnet, không cần SSR.
- **Truy cập:** bản ghi DNS trỏ IP tailnet, cộng `ipAllowList 100.64.0.0/10` trên Traefik. Gọi qua IP public thì trả 403 (đã thử).
- Không có thông báo. Tôi tự vào xem mỗi ngày; lỗi của nguồn hiện ở màn Sources.

## 10. Vận hành

- **Tài nguyên:** 3 container (db, crawler, web) giới hạn tổng 1,5 CPU và 2 GB, để không giành tài nguyên với GitLab trên cùng node. Đo thực tế: crawler khoảng 16% CPU, khoảng 90 MB RAM khi đang dò hàng trăm site.
- **Theo dõi:** `/health` trả 503 nếu 6 giờ không có việc nào chạy xong. Status page của fleet probe endpoint này qua agent trong tailnet.
- **Log:** stdout của container, Promtail gom về Loki.
- **Backup:** `pg_dump` nằm trong bộ backup Kopia chạy hằng đêm của node.
- **Test:** 84 test unit và integration chạy trên Postgres thật trong compose (`--profile test`). Có test parser trên HTML/JSON thật đã lưu, test hàng đợi (SKIP LOCKED, politeness, backoff), test gộp tin, test robots.txt.

## 11. Từ crawler lấy tin thành focused crawler

Chương 9 của Alex Xu dạy crawler tổng quát: từ vài URL hạt giống, tải trang, rút link, lọc, lặp lại để lan ra cả web. Job Radar lúc đầu chỉ đọc nguồn có sẵn (job board, danh bạ). Bản sau thêm bốn phần để thành **focused crawler**, tức crawler có chủ đề:

- **Tự lan (URL extractor + URL filter của chương 9, nhưng có chủ đề).**
  - Link từ trang công ty sang tên miền khác thành ứng viên. Ví dụ tinhvan.com dẫn sang tso.vn.
  - Mỗi tháng quét chỉ mục Parquet công khai của Common Crawl, lấy các site `.vn` có trang tuyển dụng (khoảng 8.400 site mỗi lần, đọc trong 8 phút nhờ thống kê theo cột của Parquet).
  - Bộ lọc chủ đề: luật trước. Không có dấu hiệu "doanh nghiệp IT" thì loại, dù có link tuyển dụng và địa chỉ TP.HCM. Ca lưng chừng thì hỏi Gemini, có hạn mức riêng. Hết hạn mức thì để mai, không đoán.
  - Chống spider trap: tối đa 2 hop tính từ công ty đã biết.
- **Best-first frontier.** Điểm liên quan của công ty quyết định thứ tự trong hàng đợi và nhịp đọc (6, 12 hoặc 24 giờ). Không đọc đều nhau.
- **Độ tin cậy.** Trang có thật là tin tuyển dụng không, site có đúng của công ty không, tin có cũ, đăng lại, qua trung gian hay vắng trên trang chính thức không. Mỗi cờ là một lý do hiện trên màn hình.
- **Học từ phản hồi.** Mỗi lần chủ máy bấm Interested, Applied hay Skip là một nhãn. Mô hình tỉ lệ thích theo từng đặc trưng (có làm mượt) đẩy điểm tin mới lên hoặc xuống trong ±15 điểm, mạnh dần theo số nhãn. Chương 9 không có vòng phản hồi này.

Bài học khi làm: lần đầu bộ lọc chủ đề nhận cả công ty xây dựng, dược, báo, chỉ vì có link tuyển dụng và địa chỉ TP.HCM. Soát tay 25 site thì chỉ khoảng 7 đúng. Sửa bằng cách bắt buộc phải có dấu hiệu IT cốt lõi, và không nghiêng về nhận khi thiếu ý kiến thứ hai.

## 12. Câu hỏi phỏng vấn mẫu

1. **Vì sao dùng `SKIP LOCKED`?** Để nhiều worker lấy việc song song từ một bảng mà không khoá chờ nhau, cũng không lấy trùng việc. Dòng nào đang bị worker khác khoá thì bỏ qua và lấy dòng kế.
2. **Làm sao không bị chặn?** Mỗi host có khoảng nghỉ riêng, khoá theo host trong transaction. Bị 429 thì dừng 15 phút và gấp đôi dần. Tôn trọng robots.txt. User-Agent có ghi email liên hệ. Không đăng nhập, không vượt captcha.
3. **Làm sao biết trang có tin mới mà không phải parse lại mọi thứ?** Băm nội dung chính của trang. Hash không đổi thì bỏ qua và giãn lịch kiểm. ATS thì gọi API, vốn đã trả danh sách tin.
4. **Gộp tin trùng giữa các nguồn thế nào?** Khoá "công ty + chức danh" đã chuẩn hoá, mỗi tin giữ danh sách nguồn. Không gộp bằng hash nội dung, vì JD ở mỗi nguồn hơi khác nhau.
5. **Nếu phải scale lên 1 triệu trang mỗi ngày thì đổi gì?**
   - Tách frontier sang Kafka hoặc Redis, chia theo host.
   - Nhiều node crawler, mỗi node một nhóm host để vẫn giữ được politeness.
   - Lưu HTML thô vào object storage.
   - Thêm trình duyệt headless cho trang dùng JavaScript.
   - Theo dõi theo từng nguồn bằng metric thay vì chỉ đọc log.
6. **Crawler của ông tìm công ty mới thế nào, và sao không lan ra cả web?** Hai đường: link từ trang công ty đã biết, và chỉ mục Common Crawl. Mỗi tên miền mới qua bộ lọc chủ đề (luật, rồi LLM cho ca lưng chừng). Chỉ lan tiếp từ site đã được nhận, tối đa 2 hop. Đó là focused crawler: chỉ đi theo hướng có khả năng gặp đúng loại trang mình cần.
7. **Làm sao crawler "học" gu của ông?** Mỗi quyết định trên Inbox là một nhãn. Với mỗi đặc trưng (kỹ năng, công ty, cấp bậc, hình thức làm...), tính tỉ lệ được giữ có làm mượt Laplace rồi so với tỉ lệ chung. Chênh lệch đổi ra điểm, giới hạn ±15 và nhân với độ tin theo số nhãn (đủ 40 nhãn mới đạt tối đa). Không dùng model đen, để mỗi lần điểm đổi vẫn giải thích được bằng một câu.
