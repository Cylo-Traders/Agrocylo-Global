import { Router } from "express";
import { createProduct, getProducts, getProductById } from "../controllers/productController.js";

const router = Router();

router.post("/", createProduct);
router.get("/", getProducts);
router.get("/:id", getProductById);

export default router;
