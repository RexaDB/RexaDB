CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`method` text NOT NULL,
	`url` text NOT NULL,
	`status` integer NOT NULL,
	`req_headers` text,
	`res_body` text,
	`duration` integer
);
