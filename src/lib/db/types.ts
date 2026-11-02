// DB の型。Prisma Client とトランザクションの中のクライアントの両方を受け取る関数に使う
import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "./client";

export type DbTx = Prisma.TransactionClient;
export type DbLike = Db | DbTx;
