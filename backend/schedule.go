// 班表接口：查看要有“查看班表”或“制作班表”权限，保存（导入、编辑、改设置）要有“制作班表”权限。
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"unicode/utf8"

	"github.com/Beane-Big/vibebooth/packages/sdk-go/auth"
)

// 功能权限 id，声明在 module.yaml 的 permissions 里。
const (
	permView = "view"
	permMake = "make"
)

// 能制作班表的人一定也能查看。
func canView(u *auth.User) bool { return u.Has(permView) || u.Has(permMake) }

// Document 是前端保存的整份班表。班次由后端检查格式；settings（样式、图片尺寸等）只由前端使用，原样保存。
type Document struct {
	Shifts   []Shift         `json:"shifts"`
	Yearless bool            `json:"yearless"`
	FileName string          `json:"fileName"`
	Settings json.RawMessage `json:"settings"`
}

type Shift struct {
	Date string `json:"date"`
	Name string `json:"name"`
	Time string `json:"time"`
	Note string `json:"note"`
}

var datePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// 一份班表最多一千天，足够放几年的排班；请求体上限 1MB。
const (
	maxShifts = 1000
	maxBody   = 1 << 20
)

func (d *Document) validate() error {
	if len(d.Shifts) > maxShifts {
		return fmt.Errorf("班表最多 %d 天", maxShifts)
	}
	seen := make(map[string]bool, len(d.Shifts))
	for _, s := range d.Shifts {
		switch {
		case !datePattern.MatchString(s.Date):
			return fmt.Errorf("日期格式不对：%q", s.Date)
		case seen[s.Date]:
			return fmt.Errorf("%s 出现了两次", s.Date)
		case s.Name == "" || utf8.RuneCountInString(s.Name) > 50:
			return fmt.Errorf("%s 的班次名称不能为空，也不能超过 50 个字", s.Date)
		case utf8.RuneCountInString(s.Time) > 200 || utf8.RuneCountInString(s.Note) > 200:
			return fmt.Errorf("%s 的时间或备注太长", s.Date)
		}
		seen[s.Date] = true
	}
	if utf8.RuneCountInString(d.FileName) > 200 {
		return errors.New("文件名太长")
	}
	if len(d.Settings) > 0 && d.Settings[0] != '{' && string(d.Settings) != "null" {
		return errors.New("settings 必须是对象")
	}
	return nil
}

func init() {
	routes = append(routes, func(api *http.ServeMux) {
		api.HandleFunc("GET /api/schedule2date/schedule", func(w http.ResponseWriter, r *http.Request) {
			if !canView(auth.UserFrom(r.Context())) {
				writeError(w, http.StatusForbidden, "没有“查看班表”权限")
				return
			}
			sc, err := store.Get(r.Context())
			if err != nil {
				slog.Error("读取班表失败", "err", err)
				writeError(w, http.StatusInternalServerError, "读取失败")
				return
			}
			if sc == nil {
				sc = &Schedule{Data: json.RawMessage("null")}
			}
			writeJSON(w, http.StatusOK, sc)
		})

		api.HandleFunc("PUT /api/schedule2date/schedule", func(w http.ResponseWriter, r *http.Request) {
			user := auth.UserFrom(r.Context())
			if !user.Has(permMake) {
				writeError(w, http.StatusForbidden, "没有“制作班表”权限")
				return
			}
			var in struct {
				Version int64    `json:"version"`
				Data    Document `json:"data"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(&in); err != nil {
				writeError(w, http.StatusBadRequest, "数据格式不对或太大")
				return
			}
			if err := in.Data.validate(); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			if in.Data.Shifts == nil {
				in.Data.Shifts = []Shift{}
			}
			data, _ := json.Marshal(in.Data)
			sc, err := store.Save(r.Context(), data, in.Version, user.Name)
			if errors.Is(err, ErrConflict) {
				// 把最新的班表一起返回，前端直接换成它，不用再请求一次。
				current, _ := store.Get(r.Context())
				writeJSON(w, http.StatusConflict, map[string]any{"error": "班表刚被其他人修改过，已加载最新版本", "current": current})
				return
			}
			if err != nil {
				slog.Error("保存班表失败", "err", err)
				writeError(w, http.StatusInternalServerError, "保存失败")
				return
			}
			writeJSON(w, http.StatusOK, sc)
		})
	})
}
