// EXPORTS: compressImage, getImageDimensions, formatFileSize

// 压缩图片：长边最大 1280px，JPEG quality 0.75；动图（gif）跳过压缩
export async function compressImage(file: File): Promise<Uint8Array> {
  // gif 动图不压缩
  if (file.type === 'image/gif') {
    return new Uint8Array(await file.arrayBuffer());
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    // 修复 AUDIT.md FUNC-12：此前 objectURL 在成功路径也未释放（内存泄漏）
    const objectUrl = URL.createObjectURL(file);
    const revoke = () => URL.revokeObjectURL(objectUrl);

    img.onload = () => {
      try {
        const maxSide = 1280;
        let { width, height } = img;
        if (width > height) {
          if (width > maxSide) {
            height = (height * maxSide) / width;
            width = maxSide;
          }
        } else {
          if (height > maxSide) {
            width = (width * maxSide) / height;
            height = maxSide;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 不可用'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('压缩失败'));
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              resolve(new Uint8Array(reader.result as ArrayBuffer));
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(blob);
          },
          'image/jpeg',
          0.75,
        );
      } finally {
        // 画布绘制完成后原图不再需要，立即释放
        revoke();
      }
    };
    img.onerror = () => {
      revoke();
      reject(new Error('图片加载失败'));
    };
    img.src = objectUrl;
  });
}

// 获取图片尺寸
export async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // 修复 AUDIT.md FUNC-12：onerror 分支此前未释放 objectURL
    const objectUrl = URL.createObjectURL(file);
    const revoke = () => URL.revokeObjectURL(objectUrl);

    img.onload = () => {
      try {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      } finally {
        revoke();
      }
    };
    img.onerror = () => {
      revoke();
      reject(new Error('图片加载失败'));
    };
    img.src = objectUrl;
  });
}

// 文件大小格式化
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
