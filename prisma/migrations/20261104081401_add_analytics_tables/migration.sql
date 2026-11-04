-- 003 分析: 集計テーブル（specs/003-analytics/data-model.md）。新しいテーブルを足すだけ（expand）なので、1 つ前のリリースのコードもそのまま動く

-- CreateTable
CREATE TABLE "daily_headway_stats" (
    "service_date" DATE NOT NULL,
    "route_id" TEXT NOT NULL,
    "direction_id" INTEGER NOT NULL,
    "stop_id" TEXT NOT NULL,
    "hour" SMALLINT NOT NULL,
    "n" INTEGER NOT NULL,
    "mean_sec" DOUBLE PRECISION NOT NULL,
    "p50_sec" DOUBLE PRECISION NOT NULL,
    "p90_sec" DOUBLE PRECISION NOT NULL,
    "max_sec" INTEGER NOT NULL,
    "bunching_count" INTEGER NOT NULL,
    "gap_count" INTEGER NOT NULL,

    CONSTRAINT "daily_headway_stats_pkey" PRIMARY KEY ("service_date","route_id","direction_id","stop_id","hour")
);

-- CreateTable
CREATE TABLE "daily_prediction_accuracy" (
    "service_date" DATE NOT NULL,
    "route_id" TEXT NOT NULL,
    "direction_id" INTEGER NOT NULL,
    "lead_bucket_min" SMALLINT NOT NULL,
    "update_type" TEXT NOT NULL,
    "hour" SMALLINT NOT NULL,
    "n" INTEGER NOT NULL,
    "mean_error_sec" DOUBLE PRECISION NOT NULL,
    "mean_abs_error_sec" DOUBLE PRECISION NOT NULL,
    "p90_abs_error_sec" DOUBLE PRECISION NOT NULL,
    "within_60s_ratio" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "daily_prediction_accuracy_pkey" PRIMARY KEY ("service_date","route_id","direction_id","lead_bucket_min","update_type","hour")
);

-- CreateTable
CREATE TABLE "daily_alert_stats" (
    "service_date" DATE NOT NULL,
    "route_id" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "alert_count" INTEGER NOT NULL,
    "active_minutes" INTEGER NOT NULL,

    CONSTRAINT "daily_alert_stats_pkey" PRIMARY KEY ("service_date","route_id","effect","cause")
);

-- CreateTable
CREATE TABLE "hourly_alert_minutes" (
    "service_date" DATE NOT NULL,
    "route_id" TEXT NOT NULL,
    "hour" SMALLINT NOT NULL,
    "category" TEXT NOT NULL,
    "active_minutes" INTEGER NOT NULL,

    CONSTRAINT "hourly_alert_minutes_pkey" PRIMARY KEY ("service_date","route_id","hour","category")
);

-- CreateIndex
CREATE INDEX "daily_headway_stats_route_id_service_date_idx" ON "daily_headway_stats"("route_id", "service_date");

-- CreateIndex
CREATE INDEX "daily_prediction_accuracy_route_id_service_date_idx" ON "daily_prediction_accuracy"("route_id", "service_date");

-- CreateIndex
CREATE INDEX "daily_alert_stats_route_id_service_date_idx" ON "daily_alert_stats"("route_id", "service_date");

-- CreateIndex
CREATE INDEX "hourly_alert_minutes_route_id_service_date_idx" ON "hourly_alert_minutes"("route_id", "service_date");
