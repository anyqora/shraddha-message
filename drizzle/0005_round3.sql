CREATE TABLE `audit_log` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36),
	`action` varchar(64) NOT NULL,
	`entity` varchar(64) NOT NULL DEFAULT '',
	`entity_id` varchar(64) NOT NULL DEFAULT '',
	`summary` varchar(500) NOT NULL DEFAULT '',
	`ip` varchar(64) NOT NULL DEFAULT '',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `date_wishes` (
	`id` varchar(36) NOT NULL,
	`kind` enum('birthday','anniversary') NOT NULL,
	`template_id` varchar(36),
	`body` json NOT NULL DEFAULT ('[]'),
	`send_hour` int NOT NULL DEFAULT 9,
	`active` boolean NOT NULL DEFAULT true,
	`last_run_date` varchar(10),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `date_wishes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `drip_enrollments` (
	`id` varchar(36) NOT NULL,
	`sequence_id` varchar(36) NOT NULL,
	`contact_id` varchar(36) NOT NULL,
	`step_index` int NOT NULL DEFAULT 0,
	`next_at` datetime,
	`status` enum('active','completed','stopped','failed') NOT NULL DEFAULT 'active',
	`error` varchar(500) NOT NULL DEFAULT '',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `drip_enrollments_id` PRIMARY KEY(`id`),
	CONSTRAINT `drip_enroll_uq` UNIQUE(`sequence_id`,`contact_id`)
);
--> statement-breakpoint
CREATE TABLE `drip_sequences` (
	`id` varchar(36) NOT NULL,
	`name` varchar(191) NOT NULL,
	`list_id` varchar(36),
	`steps` json NOT NULL DEFAULT ('[]'),
	`stop_on_reply` boolean NOT NULL DEFAULT true,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `drip_sequences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payment_links` (
	`id` varchar(36) NOT NULL,
	`contact_id` varchar(36),
	`provider` enum('razorpay','upi') NOT NULL,
	`provider_id` varchar(64),
	`amount` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'INR',
	`description` varchar(255) NOT NULL DEFAULT '',
	`url` varchar(500) NOT NULL,
	`status` enum('created','paid','expired','cancelled','failed') NOT NULL DEFAULT 'created',
	`paid_at` datetime,
	`created_by` varchar(36),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `payment_links_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` varchar(36) NOT NULL,
	`name` varchar(191) NOT NULL,
	`sku` varchar(64) NOT NULL DEFAULT '',
	`description` text NOT NULL,
	`price` int NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'INR',
	`image_id` varchar(128),
	`category` varchar(191) NOT NULL DEFAULT '',
	`url` varchar(500) NOT NULL DEFAULT '',
	`active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `segments` (
	`id` varchar(36) NOT NULL,
	`name` varchar(191) NOT NULL,
	`match` enum('all','any') NOT NULL DEFAULT 'all',
	`rules` json NOT NULL DEFAULT ('[]'),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `segments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wa_links` (
	`id` varchar(36) NOT NULL,
	`name` varchar(191) NOT NULL,
	`slug` varchar(64) NOT NULL,
	`message` varchar(500) NOT NULL DEFAULT '',
	`list_id` varchar(36),
	`clicks` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `wa_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `wa_links_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `contacts` ADD `birthday` varchar(5);--> statement-breakpoint
ALTER TABLE `contacts` ADD `anniversary` varchar(5);--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `drip_enroll_due_idx` ON `drip_enrollments` (`status`,`next_at`);--> statement-breakpoint
CREATE INDEX `payment_links_contact_idx` ON `payment_links` (`contact_id`);--> statement-breakpoint
CREATE INDEX `payment_links_provider_idx` ON `payment_links` (`provider_id`);