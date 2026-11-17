CREATE TABLE `companies` (
	`id` varchar(36) NOT NULL,
	`name` varchar(191) NOT NULL,
	`domain` varchar(191) NOT NULL DEFAULT '',
	`industry` varchar(191) NOT NULL DEFAULT '',
	`city` varchar(191) NOT NULL DEFAULT '',
	`phone` varchar(32) NOT NULL DEFAULT '',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `companies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deals` (
	`id` varchar(36) NOT NULL,
	`title` varchar(191) NOT NULL,
	`amount` int NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'INR',
	`pipeline_id` varchar(36) NOT NULL,
	`stage_id` varchar(36) NOT NULL,
	`contact_id` varchar(36),
	`company_id` varchar(36),
	`owner_id` varchar(36),
	`expected_close` datetime,
	`position` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `deals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` varchar(36) NOT NULL,
	`body` text NOT NULL,
	`contact_id` varchar(36),
	`company_id` varchar(36),
	`deal_id` varchar(36),
	`author_id` varchar(36),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pipeline_stages` (
	`id` varchar(36) NOT NULL,
	`pipeline_id` varchar(36) NOT NULL,
	`name` varchar(191) NOT NULL,
	`color` varchar(16) NOT NULL DEFAULT 'gray',
	`position` int NOT NULL DEFAULT 0,
	`kind` enum('open','won','lost') NOT NULL DEFAULT 'open',
	CONSTRAINT `pipeline_stages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pipelines` (
	`id` varchar(36) NOT NULL,
	`name` varchar(191) NOT NULL,
	`position` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `pipelines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quick_replies` (
	`id` varchar(36) NOT NULL,
	`shortcut` varchar(64) NOT NULL,
	`body` text NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `quick_replies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` varchar(36) NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`status` enum('todo','in_progress','done') NOT NULL DEFAULT 'todo',
	`due_at` datetime,
	`assignee_id` varchar(36),
	`contact_id` varchar(36),
	`company_id` varchar(36),
	`deal_id` varchar(36),
	`created_by` varchar(36),
	`completed_at` datetime,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `contacts` ADD `company_id` varchar(36);--> statement-breakpoint
ALTER TABLE `contacts` ADD `assigned_to` varchar(36);--> statement-breakpoint
ALTER TABLE `contacts` ADD `chat_status` enum('open','closed') DEFAULT 'open' NOT NULL;--> statement-breakpoint
CREATE INDEX `companies_name_idx` ON `companies` (`name`);--> statement-breakpoint
CREATE INDEX `deals_stage_idx` ON `deals` (`stage_id`,`position`);--> statement-breakpoint
CREATE INDEX `deals_contact_idx` ON `deals` (`contact_id`);--> statement-breakpoint
CREATE INDEX `notes_contact_idx` ON `notes` (`contact_id`);--> statement-breakpoint
CREATE INDEX `notes_company_idx` ON `notes` (`company_id`);--> statement-breakpoint
CREATE INDEX `notes_deal_idx` ON `notes` (`deal_id`);--> statement-breakpoint
CREATE INDEX `stages_pipeline_idx` ON `pipeline_stages` (`pipeline_id`,`position`);--> statement-breakpoint
CREATE INDEX `tasks_status_due_idx` ON `tasks` (`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `tasks_contact_idx` ON `tasks` (`contact_id`);