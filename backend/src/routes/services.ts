import { Router, Request, Response } from "express";
import db from "../db.js";

export const servicesRouter = Router();

servicesRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const { rows } = await db.query(
      "SELECT id, name, duration, price, active FROM services WHERE active = true ORDER BY id"
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Error al obtener servicios" });
  }
});
