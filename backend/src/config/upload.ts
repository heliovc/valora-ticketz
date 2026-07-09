import path from "path";
import multer from "multer";
import { randomBytes } from "crypto";

const publicFolder = __dirname.endsWith("/dist")
  ? path.resolve(__dirname, "..", "public")
  : path.resolve(__dirname, "..", "..", "public");

export default {
  directory: publicFolder,

  storage: multer.diskStorage({
    destination: publicFolder,
    filename(req, file, cb) {
      // Nome com componente ALEATÓRIO (antes era só Date.now() → previsível/
      // enumerável, permitindo download cross-tenant de anexos por timestamp).
      const rand = randomBytes(12).toString("hex");
      const fileName = `${Date.now()}-${rand}${path.extname(file.originalname)}`;

      return cb(null, fileName);
    }
  })
};
