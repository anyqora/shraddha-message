CREATE TABLE `api_keys` (
	`id` varchar(36) NOT NULL,
	`name` varchar(191) NOT NULL,
	`prefix` varchar(16) NOT NULL,
	`key_hash` varchar(64) NOT NULL,
	`last_used_at` datetime,
	`created_by` varchar(36),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_keys_key_hash_unique` UNIQUE(`key_hash`)
);
--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` varchar(64) NOT NULL,
	`kind` enum('reset','invite') NOT NULL,
	`user_id` varchar(36),
	`email` varchar(191) NOT NULL DEFAULT '',
	`role` enum('admin','agent') NOT NULL DEFAULT 'agent',
	`expires_at` datetime NOT NULL,
	`used_at` datetime,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `auth_tokens_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` varchar(36) NOT NULL,
	`automation_id` varchar(36) NOT NULL,
	`contact_id` varchar(36),
	`step_index` int NOT NULL DEFAULT 0,
	`status` enum('waiting','running','done','failed') NOT NULL DEFAULT 'running',
	`resume_at` datetime,
	`error` varchar(500) NOT NULL DEFAULT '',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `automation_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `automations` (
	`id` varchar(36) NOT NULL,
	`name` varchar(191) NOT NULL,
	`trigger` json NOT NULL,
	`steps` json NOT NULL DEFAULT ('[]'),
	`active` boolean NOT NULL DEFAULT true,
	`runs` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `automations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `media_files` (
	`id` varchar(128) NOT NULL,
	`mime` varchar(128) NOT NULL,
	`filename` varchar(255) NOT NULL DEFAULT '',
	`size` int NOT NULL DEFAULT 0,
	`data` longblob NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `media_files_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`type` varchar(32) NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` varchar(500) NOT NULL DEFAULT '',
	`link` varchar(255) NOT NULL DEFAULT '',
	`read_at` datetime,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`id` varchar(36) NOT NULL,
	`url` varchar(500) NOT NULL,
	`secret` varchar(128) NOT NULL,
	`events` json NOT NULL DEFAULT ('[]'),
	`active` boolean NOT NULL DEFAULT true,
	`last_status` int,
	`last_error` varchar(500) NOT NULL DEFAULT '',
	`last_at` datetime,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `webhook_endpoints_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `ai_knowledge` ADD `source` varchar(255) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bot_rules` ADD `pos_x` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bot_rules` ADD `pos_y` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `channel` enum('whatsapp','web') DEFAULT 'whatsapp' NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `web_visitor_id` varchar(64);--> statement-breakpoint
ALTER TABLE `messages` ADD `reaction` varchar(16) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD CONSTRAINT `contacts_web_visitor_uq` UNIQUE(`web_visitor_id`);--> statement-breakpoint
CREATE INDEX `automation_runs_status_resume_idx` ON `automation_runs` (`status`,`resume_at`);--> statement-breakpoint
CREATE INDEX `automation_runs_automation_idx` ON `automation_runs` (`automation_id`);--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`read_at`,`created_at`);