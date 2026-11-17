CREATE TABLE `bot_rules` (
	`id` varchar(36) NOT NULL,
	`name` varchar(191) NOT NULL,
	`trigger` enum('keyword','welcome','fallback','menu') NOT NULL DEFAULT 'keyword',
	`keywords` varchar(1000) NOT NULL DEFAULT '',
	`match_type` enum('exact','contains','starts') NOT NULL DEFAULT 'contains',
	`reply_type` enum('text','buttons','list') NOT NULL DEFAULT 'text',
	`header` varchar(60) NOT NULL DEFAULT '',
	`body` text NOT NULL,
	`footer` varchar(60) NOT NULL DEFAULT '',
	`list_button` varchar(20) NOT NULL DEFAULT 'Menu',
	`options` json NOT NULL DEFAULT ('[]'),
	`handoff` boolean NOT NULL DEFAULT false,
	`active` boolean NOT NULL DEFAULT true,
	`priority` int NOT NULL DEFAULT 100,
	`hits` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `bot_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `contacts` ADD `bot_paused_until` datetime;--> statement-breakpoint
CREATE INDEX `bot_rules_trigger_idx` ON `bot_rules` (`trigger`,`active`);