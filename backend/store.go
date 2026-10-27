package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	_ "modernc.org/sqlite"
)

// Schedule 是当前的班表：整份班表和配置存成一个 JSON 文档，只保留最新一份，导入新的就覆盖。
// Version 每保存一次加 1，用来发现两个人同时编辑时的冲突。
type Schedule struct {
	Data      json.RawMessage `json:"data"`
	Version   int64           `json:"version"`
	UpdatedBy string          `json:"updatedBy"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// ErrConflict 表示保存时别人已经先改过了。
var ErrConflict = errors.New("班表已被其他人修改")

type Store struct {
	db *sql.DB
}

// 表结构在启动时创建；以后加字段用 ALTER TABLE，并保证老数据还能读。
// schedule 表最多一行（id 固定为 1）。
const schema = `
CREATE TABLE IF NOT EXISTS schedule (
	id         INTEGER PRIMARY KEY CHECK (id = 1),
	data       TEXT NOT NULL,
	version    INTEGER NOT NULL,
	updated_by TEXT NOT NULL,
	updated_at TIMESTAMP NOT NULL
);
`

// OpenStore 打开模块自己的 SQLite 文件；数据库只属于本模块，放在本模块的卷里。
func OpenStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	// SQLite 同一时间只允许一个写入者，单连接可以避免 "database is locked"。
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

// Get 返回当前班表；还没有人导入过时返回 nil。
func (s *Store) Get(ctx context.Context) (*Schedule, error) {
	var sc Schedule
	var data string
	err := s.db.QueryRowContext(ctx, `SELECT data, version, updated_by, updated_at FROM schedule WHERE id = 1`).
		Scan(&data, &sc.Version, &sc.UpdatedBy, &sc.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	sc.Data = json.RawMessage(data)
	return &sc, nil
}

// Save 用 data 覆盖当前班表。base 是保存人看到的版本（还没有班表时是 0），
// 和库里的版本不一致说明别人先改过了，返回 ErrConflict，什么都不改。
func (s *Store) Save(ctx context.Context, data json.RawMessage, base int64, by string) (*Schedule, error) {
	now := time.Now().UTC()
	var res sql.Result
	var err error
	if base == 0 {
		res, err = s.db.ExecContext(ctx,
			`INSERT INTO schedule (id, data, version, updated_by, updated_at) VALUES (1, ?, 1, ?, ?) ON CONFLICT (id) DO NOTHING`,
			string(data), by, now)
	} else {
		res, err = s.db.ExecContext(ctx,
			`UPDATE schedule SET data = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = 1 AND version = ?`,
			string(data), by, now, base)
	}
	if err != nil {
		return nil, err
	}
	if n, err := res.RowsAffected(); err != nil {
		return nil, err
	} else if n == 0 {
		return nil, ErrConflict
	}
	return &Schedule{Data: data, Version: base + 1, UpdatedBy: by, UpdatedAt: now}, nil
}
