CREATE TABLE `appointments` (
	`id` varchar(36) NOT NULL,
	`contact_id` varchar(36),
	`service` varchar(191) NOT NULL DEFAULT '',
	`start_at` datetime NOT NULL,
	`duration_min` int NOT NULL DEFAULT 30,
	`status` enum('booked','confirmed','cancelled','completed','no_show') NOT NULL DEFAULT 'booked',
	`notes` text NOT NULL,
	`assigned_to` varchar(36),
	`reminder_sent_at` datetime,
	`source` varchar(32) NOT NULL DEFAULT 'manual',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `appointments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` varchar(36) NOT NULL,
	`contact_id` varchar(36),
	`title` varchar(191) NOT NULL DEFAULT '',
	`source` varchar(64) NOT NULL DEFAULT 'chatbot',
	`data` json NOT NULL DEFAULT ('{}'),
	`status` enum('new','contacted','qualified','converted','lost') NOT NULL DEFAULT 'new',
	`assigned_to` varchar(36),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `bot_rules` MODIFY COLUMN `reply_type` enum('text','buttons','list','question','book','lead') NOT NULL DEFAULT 'text';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('admin','manager','agent') NOT NULL DEFAULT 'agent';--> statement-breakpoint
ALTER TABLE `bot_rules` ADD `save_to` varchar(100) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bot_rules` ADD `validation` enum('none','email','phone','number','date') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `bot_rules` ADD `next_rule_id` varchar(36);--> statement-breakpoint
ALTER TABLE `contacts` ADD `bot_state` json;--> statement-breakpoint
CREATE INDEX `appointments_start_idx` ON `appointments` (`start_at`);--> statement-breakpoint
CREATE INDEX `appointments_contact_idx` ON `appointments` (`contact_id`);--> statement-breakpoint
CREATE INDEX `leads_status_idx` ON `leads` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `leads_contact_idx` ON `leads` (`contact_id`);