CREATE TABLE `campaign_recipients` (
	`id` varchar(36) NOT NULL,
	`campaign_id` varchar(36) NOT NULL,
	`contact_id` varchar(36),
	`phone` varchar(20) NOT NULL,
	`name` varchar(191) NOT NULL DEFAULT '',
	`params` json NOT NULL,
	`status` enum('pending','sent','delivered','read','failed','skipped') NOT NULL DEFAULT 'pending',
	`wamid` varchar(128),
	`error` varchar(500) NOT NULL DEFAULT '',
	`sent_at` datetime,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `campaign_recipients_id` PRIMARY KEY(`id`),
	CONSTRAINT `cr_wamid_uq` UNIQUE(`wamid`)
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` varchar(36) NOT NULL,
	`name` varchar(191) NOT NULL,
	`template_id` varchar(36),
	`template_name` varchar(191) NOT NULL,
	`template_language` varchar(16) NOT NULL,
	`status` enum('scheduled','running','paused','completed','failed') NOT NULL DEFAULT 'scheduled',
	`scheduled_at` datetime NOT NULL,
	`audience` varchar(255) NOT NULL DEFAULT '',
	`header_media_id` varchar(128),
	`header_media_type` varchar(16),
	`mapping` json NOT NULL,
	`total` int NOT NULL DEFAULT 0,
	`skipped` int NOT NULL DEFAULT 0,
	`last_error` varchar(500) NOT NULL DEFAULT '',
	`created_by` varchar(36),
	`started_at` datetime,
	`completed_at` datetime,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` varchar(36) NOT NULL,
	`phone` varchar(20) NOT NULL,
	`name` varchar(191) NOT NULL DEFAULT '',
	`email` varchar(191) NOT NULL DEFAULT '',
	`custom` json NOT NULL DEFAULT ('{}'),
	`opted_out` boolean NOT NULL DEFAULT false,
	`opted_out_at` datetime,
	`unread_count` int NOT NULL DEFAULT 0,
	`last_message_at` datetime(3),
	`last_inbound_at` datetime(3),
	`last_message_preview` varchar(255) NOT NULL DEFAULT '',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `contacts_id` PRIMARY KEY(`id`),
	CONSTRAINT `contacts_phone_uq` UNIQUE(`phone`)
);
--> statement-breakpoint
CREATE TABLE `list_members` (
	`list_id` varchar(36) NOT NULL,
	`contact_id` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `list_members_list_id_contact_id_pk` PRIMARY KEY(`list_id`,`contact_id`)
);
--> statement-breakpoint
CREATE TABLE `lists` (
	`id` varchar(36) NOT NULL,
	`name` varchar(191) NOT NULL,
	`description` varchar(500) NOT NULL DEFAULT '',
	`color` varchar(16) NOT NULL DEFAULT 'blue',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `lists_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` varchar(36) NOT NULL,
	`contact_id` varchar(36) NOT NULL,
	`direction` enum('in','out') NOT NULL,
	`type` varchar(24) NOT NULL DEFAULT 'text',
	`body` mediumtext NOT NULL,
	`media` json,
	`template_name` varchar(191),
	`wamid` varchar(128),
	`status` enum('pending','sent','delivered','read','failed','received') NOT NULL DEFAULT 'pending',
	`error` varchar(500) NOT NULL DEFAULT '',
	`campaign_id` varchar(36),
	`sent_by` varchar(36),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `messages_wamid_uq` UNIQUE(`wamid`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(64) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`expires_at` datetime NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(64) NOT NULL,
	`value` text NOT NULL,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` varchar(36) NOT NULL,
	`meta_id` varchar(64),
	`name` varchar(191) NOT NULL,
	`language` varchar(16) NOT NULL,
	`category` varchar(32) NOT NULL DEFAULT 'MARKETING',
	`status` varchar(32) NOT NULL DEFAULT 'DRAFT',
	`rejected_reason` varchar(255) NOT NULL DEFAULT '',
	`components` json NOT NULL DEFAULT ('[]'),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `templates_name_lang_uq` UNIQUE(`name`,`language`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL DEFAULT '',
	`password_hash` varchar(255) NOT NULL,
	`role` enum('admin','agent') NOT NULL DEFAULT 'agent',
	`last_sign_in_at` datetime,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE INDEX `cr_campaign_status_idx` ON `campaign_recipients` (`campaign_id`,`status`);--> statement-breakpoint
CREATE INDEX `campaigns_status_sched_idx` ON `campaigns` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `contacts_last_message_idx` ON `contacts` (`last_message_at`);--> statement-breakpoint
CREATE INDEX `contacts_name_idx` ON `contacts` (`name`);--> statement-breakpoint
CREATE INDEX `list_members_contact_idx` ON `list_members` (`contact_id`);--> statement-breakpoint
CREATE INDEX `messages_contact_created_idx` ON `messages` (`contact_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);