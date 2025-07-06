# Dùng Node.js image chính thức
FROM node:20-alpine

# Đặt thư mục làm việc bên trong container
WORKDIR /app

# Sao chép toàn bộ project vào container
COPY . .

# Cài đặt các gói phụ thuộc
RUN npm install

# Mặc định sẽ chạy app (có thể override khi khởi chạy cron)
CMD ["npm", "start"]

