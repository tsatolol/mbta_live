# prod 環境。違いは terraform.tfvars の値だけ（docs/architecture.md の「環境の違い」）

provider "google" {
  project = var.project_id
  region  = var.region
}

module "app" {
  source = "../../modules/app"

  env                      = "prod"
  project_id               = var.project_id
  region                   = var.region
  image                    = var.image
  collector_schedule       = var.collector_schedule
  raw_retention_days       = var.raw_retention_days
  db_backup_retained_count = var.db_backup_retained_count
  db_deletion_protection   = var.db_deletion_protection
  mbta_api_key_enabled     = var.mbta_api_key_enabled
}

output "web_service_name" {
  value = module.app.web_service_name
}

output "job_names" {
  value = module.app.job_names
}

output "sql_instance" {
  value = module.app.sql_instance
}
