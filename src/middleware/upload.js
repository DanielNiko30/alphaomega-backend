const multer = require("multer");

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    console.log("File mimetype:", file.mimetype, "Filename:", file.originalname);

    const allowedExtensions = ["jpg", "jpeg", "png"];
    const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png"];

    const fileExtension = file.originalname.split(".").pop().toLowerCase();

    if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
        cb(null, true);
    } else {
        cb(new Error("Format file tidak didukung! Hanya JPG, JPEG, dan PNG"), false);
    }
};


const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: fileFilter
});

module.exports = upload;
