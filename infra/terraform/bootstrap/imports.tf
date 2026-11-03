# 画面で作った GitHub の設定を、最初の apply で取り込む（取り込んだ後もこのファイルは残してよい）

import {
  to = github_repository.this
  id = var.github_repository
}

import {
  to = github_repository_ruleset.main
  id = "${var.github_repository}:${var.main_ruleset_id}"
}
