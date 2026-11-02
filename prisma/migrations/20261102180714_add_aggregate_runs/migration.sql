-- CreateTable
CREATE TABLE "aggregate_runs" (
    "service_date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "definition_version" INTEGER NOT NULL,

    CONSTRAINT "aggregate_runs_pkey" PRIMARY KEY ("service_date")
);
