// scripts/importNametags.js
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin'); // Import Firebase Admin SDK

// ************************************************************
// CHÚ Ý: Cấu hình Firebase Admin SDK
// Bạn cần cung cấp thông tin đăng nhập tài khoản dịch vụ của mình
// ************************************************************
// Cách 1: Sử dụng biến môi trường (khuyên dùng cho triển khai)
// Nếu bạn đã thiết lập GOOGLE_APPLICATION_CREDENTIALS trong môi trường,
// Firebase Admin SDK sẽ tự động tìm thấy.
// Nếu không, hãy đảm bảo các biến môi trường này được đặt (cho môi trường cục bộ)
// process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(__dirname, '../path/to/your/serviceAccountKey.json');

// Cách 2: Trực tiếp cung cấp service account key (chỉ để phát triển/thử nghiệm)
// Thay thế 'path/to/your/serviceAccountKey.json' bằng đường dẫn thực tế của bạn
const serviceAccount = require(path.resolve(__dirname, '../config/next-62115-firebase-adminsdk-fbsvc-831aef7d77.json'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
    // databaseURL: 'https://your-project-id.firebaseio.com' // Tùy chọn, nếu bạn dùng Realtime Database
  });
}

const db = admin.firestore(); // Lấy instance Firestore

const NAMETAGS_DIR = path.resolve(__dirname, '../public/nametags');
const NAMETAGS_COLLECTION = 'nametags';

async function importNametags() {
  console.log(`Bắt đầu nhập nametags từ thư mục: ${NAMETAGS_DIR}`);

  try {
    const files = fs.readdirSync(NAMETAGS_DIR);
    let totalImported = 0;

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(NAMETAGS_DIR, file);
        console.log(`Đọc file: ${filePath}`);

        try {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          const data = JSON.parse(fileContent);

          for (const address in data) {
            const nametag = data[address];
            const normalizedAddress = address.toLowerCase();

            // Cấu trúc document để lưu vào Firestore
            const firestoreDocument = {
              Labels: nametag.Labels, // Giữ nguyên cấu trúc Labels
              // Address: nametag.Address || normalizedAddress, // Tùy chọn: giữ trường Address nếu cần
              last_updated: new Date().toISOString(), // Thêm timestamp cập nhật
            };

            await db.collection(NAMETAGS_COLLECTION).doc(normalizedAddress).set(firestoreDocument, { merge: true });
            console.log(`  Đã nhập: ${normalizedAddress}`);
            totalImported++;
          }
        } catch (parseError) {
          console.error(`Lỗi phân tích cú pháp hoặc xử lý file ${file}:`, parseError.message);
        }
      }
    }
    console.log(`\nHoàn thành! Tổng số nametags đã nhập: ${totalImported}`);
  } catch (dirError) {
    console.error(`Lỗi đọc thư mục ${NAMETAGS_DIR}:`, dirError.message);
  } finally {
    // Thoát tiến trình Node.js sau khi hoàn thành
    process.exit(0);
  }
}

importNametags();