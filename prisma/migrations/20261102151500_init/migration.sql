-- 手書きの変更（prisma migrate dev --create-only で作った SQL を書き換えた）:
-- 1. 日ごとの子テーブルを置くスキーマ "partitions" を作る（Prisma の管理対象外。specs/001-data-collection/data-model.md）
-- 2. 履歴テーブル vehicle_positions / prediction_samples / arrival_events を PARTITION BY RANGE にする
--    子テーブルは src/lib/db/partitions.ts の ensurePartitions() が運行日ごとに作る

CREATE SCHEMA IF NOT EXISTS "partitions";

-- CreateTable
CREATE TABLE "routes" (
    "id" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "long_name" TEXT NOT NULL,
    "type" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "text_color" TEXT NOT NULL,
    "direction_names" JSONB NOT NULL,
    "direction_destinations" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stops" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "location_type" INTEGER NOT NULL,
    "parent_station_id" TEXT,
    "platform_name" TEXT,
    "vehicle_type" INTEGER,

    CONSTRAINT "stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_patterns" (
    "id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "direction_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "typicality" INTEGER NOT NULL,
    "canonical" BOOLEAN NOT NULL,
    "shape_polyline" TEXT,
    "platform_stop_ids" JSONB NOT NULL,
    "station_ids" JSONB NOT NULL,

    CONSTRAINT "route_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles_current" (
    "vehicle_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "trip_id" TEXT,
    "direction_id" INTEGER,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "bearing" INTEGER,
    "current_status" TEXT NOT NULL,
    "stop_id" TEXT,
    "current_stop_sequence" INTEGER,
    "label" TEXT,
    "revenue" TEXT,
    "speed" DOUBLE PRECISION,
    "carriages" JSONB,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "polled_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vehicles_current_pkey" PRIMARY KEY ("vehicle_id")
);

-- CreateTable
CREATE TABLE "predictions_current" (
    "id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "stop_id" TEXT NOT NULL,
    "direction_id" INTEGER NOT NULL,
    "stop_sequence" INTEGER,
    "arrival_time" TIMESTAMPTZ,
    "departure_time" TIMESTAMPTZ,
    "status" TEXT,
    "schedule_relationship" TEXT,
    "update_type" TEXT,
    "uncertainty_sec" INTEGER,
    "vehicle_id" TEXT,
    "polled_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "predictions_current_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "severity" INTEGER NOT NULL,
    "header" TEXT NOT NULL,
    "short_header" TEXT,
    "service_effect" TEXT,
    "timeframe" TEXT,
    "description" TEXT,
    "lifecycle" TEXT NOT NULL,
    "active_period" JSONB NOT NULL,
    "informed_entity" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ,
    "first_seen_at" TIMESTAMPTZ NOT NULL,
    "last_seen_at" TIMESTAMPTZ NOT NULL,
    "in_feed" BOOLEAN NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_routes" (
    "alert_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,

    CONSTRAINT "alert_routes_pkey" PRIMARY KEY ("alert_id","route_id")
);

-- CreateTable
CREATE TABLE "vehicle_positions" (
    "vehicle_id" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "polled_at" TIMESTAMPTZ NOT NULL,
    "route_id" TEXT NOT NULL,
    "trip_id" TEXT,
    "direction_id" INTEGER,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "bearing" INTEGER,
    "current_status" TEXT NOT NULL,
    "stop_id" TEXT,
    "current_stop_sequence" INTEGER,

    CONSTRAINT "vehicle_positions_pkey" PRIMARY KEY ("vehicle_id","updated_at")
) PARTITION BY RANGE ("updated_at");

-- CreateTable
CREATE TABLE "prediction_samples" (
    "service_date" DATE NOT NULL,
    "trip_id" TEXT NOT NULL,
    "stop_id" TEXT NOT NULL,
    "lead_bucket_min" SMALLINT NOT NULL,
    "route_id" TEXT NOT NULL,
    "direction_id" INTEGER NOT NULL,
    "update_type" TEXT,
    "uncertainty_sec" INTEGER,
    "predicted_arrival_at" TIMESTAMPTZ NOT NULL,
    "observed_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "prediction_samples_pkey" PRIMARY KEY ("service_date","trip_id","stop_id","lead_bucket_min")
) PARTITION BY RANGE ("service_date");

-- CreateTable
CREATE TABLE "arrival_events" (
    "service_date" DATE NOT NULL,
    "trip_id" TEXT NOT NULL,
    "stop_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "direction_id" INTEGER NOT NULL,
    "vehicle_id" TEXT,
    "arrived_at" TIMESTAMPTZ NOT NULL,
    "source" TEXT NOT NULL,
    "precision_sec" INTEGER NOT NULL,

    CONSTRAINT "arrival_events_pkey" PRIMARY KEY ("service_date","trip_id","stop_id")
) PARTITION BY RANGE ("service_date");

-- CreateTable
CREATE TABLE "collector_runs" (
    "id" SERIAL NOT NULL,
    "job" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL,
    "counts" JSONB,
    "ratelimit_remaining" INTEGER,
    "error" TEXT,

    CONSTRAINT "collector_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unknown_stop_ids" (
    "stop_id" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ NOT NULL,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "unknown_stop_ids_pkey" PRIMARY KEY ("stop_id")
);

-- CreateIndex
CREATE INDEX "stops_parent_station_id_idx" ON "stops"("parent_station_id");

-- CreateIndex
CREATE INDEX "route_patterns_route_id_direction_id_idx" ON "route_patterns"("route_id", "direction_id");

-- CreateIndex
CREATE INDEX "predictions_current_stop_id_idx" ON "predictions_current"("stop_id");

-- CreateIndex
CREATE INDEX "predictions_current_trip_id_idx" ON "predictions_current"("trip_id");

-- CreateIndex
CREATE INDEX "alert_routes_route_id_idx" ON "alert_routes"("route_id");

-- CreateIndex
CREATE INDEX "collector_runs_job_started_at_idx" ON "collector_runs"("job", "started_at");
