package main

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveOverwritesAndDetectsConflict(t *testing.T) {
	s, err := OpenStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if sc, err := s.Get(ctx); err != nil || sc != nil {
		t.Fatalf("空库应返回 nil：%v %v", sc, err)
	}

	first, err := s.Save(ctx, json.RawMessage(`{"shifts":[]}`), 0, "甲")
	if err != nil || first.Version != 1 {
		t.Fatalf("第一次保存：%v %v", first, err)
	}
	// 还当没有班表（版本 0）再存一次，说明别人已经先导入了。
	if _, err := s.Save(ctx, json.RawMessage(`{}`), 0, "乙"); !errors.Is(err, ErrConflict) {
		t.Fatalf("应该冲突：%v", err)
	}
	second, err := s.Save(ctx, json.RawMessage(`{"fileName":"b"}`), 1, "乙")
	if err != nil || second.Version != 2 {
		t.Fatalf("覆盖保存：%v %v", second, err)
	}
	// 拿着旧版本保存会被拒绝，数据不变。
	if _, err := s.Save(ctx, json.RawMessage(`{"fileName":"c"}`), 1, "甲"); !errors.Is(err, ErrConflict) {
		t.Fatalf("旧版本应该冲突：%v", err)
	}
	got, err := s.Get(ctx)
	if err != nil || got.Version != 2 || got.UpdatedBy != "乙" || string(got.Data) != `{"fileName":"b"}` {
		t.Fatalf("应只保留最新一份：%+v %v", got, err)
	}
}

func TestValidate(t *testing.T) {
	ok := Document{Shifts: []Shift{{Date: "2026-10-01", Name: "白4", Time: "10:00-18:30"}}, Settings: json.RawMessage(`{}`)}
	if err := ok.validate(); err != nil {
		t.Fatal(err)
	}
	bad := map[string]Document{
		"日期格式": {Shifts: []Shift{{Date: "10/1", Name: "白4"}}},
		"日期重复": {Shifts: []Shift{{Date: "2026-10-01", Name: "a"}, {Date: "2026-10-01", Name: "b"}}},
		"空班次":  {Shifts: []Shift{{Date: "2026-10-01"}}},
		"备注太长": {Shifts: []Shift{{Date: "2026-10-01", Name: "a", Note: strings.Repeat("字", 201)}}},
		"设置类型": {Settings: json.RawMessage(`[1]`)},
	}
	for name, d := range bad {
		if err := d.validate(); err == nil {
			t.Errorf("%s 应该报错", name)
		}
	}
}
