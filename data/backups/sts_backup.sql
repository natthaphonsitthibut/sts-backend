--
-- PostgreSQL database dump
--

\restrict bc6hK9il0kuIl8TAiLWOzYOpQYQlzCVQdWE1LhdOILBXPcSFhqWccAhxPhMPKC2

-- Dumped from database version 15.18
-- Dumped by pg_dump version 15.18

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO postgres;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: postgres
--

COMMENT ON SCHEMA public IS '';


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$;


ALTER FUNCTION public.set_updated_at() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: assistance_measures; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assistance_measures (
    id integer NOT NULL,
    label text NOT NULL
);


ALTER TABLE public.assistance_measures OWNER TO postgres;

--
-- Name: assistance_measures_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.assistance_measures_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.assistance_measures_id_seq OWNER TO postgres;

--
-- Name: assistance_measures_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.assistance_measures_id_seq OWNED BY public.assistance_measures.id;


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.attendance (
    "AttendanceID" integer NOT NULL,
    "PersonID_Onec" character varying(20) NOT NULL,
    "SchoolID_Onec" integer NOT NULL,
    "GradeLevelID_Onec" integer NOT NULL,
    "RoomID_Onec" integer NOT NULL,
    "AcademicYear_Onec" integer NOT NULL,
    "Semester_Onec" integer NOT NULL,
    "AttendanceDate" date NOT NULL,
    "Period" integer NOT NULL,
    "AttendanceStatus" smallint NOT NULL,
    "RecordedAt" timestamp without time zone DEFAULT now(),
    "RecordedBy" character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer
);


ALTER TABLE public.attendance OWNER TO postgres;

--
-- Name: attendance_AttendanceID_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."attendance_AttendanceID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public."attendance_AttendanceID_seq" OWNER TO postgres;

--
-- Name: attendance_AttendanceID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."attendance_AttendanceID_seq" OWNED BY public.attendance."AttendanceID";


--
-- Name: case_reviews; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.case_reviews (
    id text NOT NULL,
    case_id integer,
    review_action text NOT NULL,
    review_note text,
    reviewed_by text,
    reviewed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer
);


ALTER TABLE public.case_reviews OWNER TO postgres;

--
-- Name: cases; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cases (
    id integer NOT NULL,
    student_name text NOT NULL,
    student_school text,
    student_address text,
    student_lat real,
    student_lng real,
    reason_flagged text,
    status text DEFAULT 'OPEN'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    result_summary text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer,
    student_id text
);


ALTER TABLE public.cases OWNER TO postgres;

--
-- Name: cases_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.cases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.cases_id_seq OWNER TO postgres;

--
-- Name: cases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.cases_id_seq OWNED BY public.cases.id;


--
-- Name: dropout_reasons; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.dropout_reasons (
    id integer NOT NULL,
    label text NOT NULL
);


ALTER TABLE public.dropout_reasons OWNER TO postgres;

--
-- Name: dropout_reasons_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.dropout_reasons_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.dropout_reasons_id_seq OWNER TO postgres;

--
-- Name: dropout_reasons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.dropout_reasons_id_seq OWNED BY public.dropout_reasons.id;


--
-- Name: educational_areas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.educational_areas (
    id integer NOT NULL,
    name text NOT NULL
);


ALTER TABLE public.educational_areas OWNER TO postgres;

--
-- Name: educational_areas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.educational_areas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.educational_areas_id_seq OWNER TO postgres;

--
-- Name: educational_areas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.educational_areas_id_seq OWNED BY public.educational_areas.id;


--
-- Name: external_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.external_users (
    "ExternalID" integer NOT NULL,
    "PersonID_Onec" text,
    "FullName" text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.external_users OWNER TO postgres;

--
-- Name: external_users_ExternalID_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."external_users_ExternalID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public."external_users_ExternalID_seq" OWNER TO postgres;

--
-- Name: external_users_ExternalID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."external_users_ExternalID_seq" OWNED BY public.external_users."ExternalID";


--
-- Name: grade_levels; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.grade_levels (
    id integer NOT NULL,
    label text NOT NULL,
    category text
);


ALTER TABLE public.grade_levels OWNER TO postgres;

--
-- Name: migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.migrations (
    id integer NOT NULL,
    "timestamp" bigint NOT NULL,
    name character varying NOT NULL
);


ALTER TABLE public.migrations OWNER TO postgres;

--
-- Name: migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.migrations_id_seq OWNER TO postgres;

--
-- Name: migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.migrations_id_seq OWNED BY public.migrations.id;


--
-- Name: related_agencies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.related_agencies (
    id integer NOT NULL,
    name text NOT NULL
);


ALTER TABLE public.related_agencies OWNER TO postgres;

--
-- Name: related_agencies_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.related_agencies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.related_agencies_id_seq OWNER TO postgres;

--
-- Name: related_agencies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.related_agencies_id_seq OWNED BY public.related_agencies.id;


--
-- Name: risk_factors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.risk_factors (
    id integer NOT NULL,
    label text NOT NULL
);


ALTER TABLE public.risk_factors OWNER TO postgres;

--
-- Name: risk_factors_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.risk_factors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.risk_factors_id_seq OWNER TO postgres;

--
-- Name: risk_factors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.risk_factors_id_seq OWNED BY public.risk_factors.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    name text NOT NULL,
    label text NOT NULL,
    rank integer DEFAULT 0 NOT NULL,
    default_permissions jsonb DEFAULT '[]'::jsonb NOT NULL,
    scope_mode text DEFAULT 'flexible'::text NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer
);


ALTER TABLE public.roles OWNER TO postgres;

--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.roles_id_seq OWNER TO postgres;

--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: schedules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.schedules (
    id integer NOT NULL,
    grade text,
    room text,
    day_of_week integer,
    subject text,
    start_time text,
    end_time text,
    teacher text
);


ALTER TABLE public.schedules OWNER TO postgres;

--
-- Name: schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.schedules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.schedules_id_seq OWNER TO postgres;

--
-- Name: schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.schedules_id_seq OWNED BY public.schedules.id;


--
-- Name: schools; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.schools (
    id integer NOT NULL,
    name text NOT NULL,
    province text,
    district text,
    sub_district text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer
);


ALTER TABLE public.schools OWNER TO postgres;

--
-- Name: student_dropouts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.student_dropouts (
    "ProvinceNameThai_Onec" text,
    "DistrictNameThai_Onec" text,
    "SubDistrictNameThai_Onec" text,
    "PersonID_Onec" text NOT NULL,
    "Fullname_Onec" text,
    "Gender_Onec" text,
    "NationalityName_Onec" text,
    "BirthDate_Onec" text,
    "HouseNumber_Onec" text,
    "VillageNumber_Onec" text,
    "Street_Onec" text,
    "Soi_Onec" text,
    "Trok_Onec" text,
    "StatusCodeCause_Onec" text,
    "Remark_Onec" text,
    "SchoolName_Onec" text,
    "GradeLevelID_Onec" integer,
    "AcademicYearPresent_Onec" integer,
    "DropoutTransferID_Onec" integer,
    "ACADYEAR" integer,
    "RoomID_Onec" integer,
    "SchoolID_Onec" integer,
    "GenderID_Onec" integer,
    "GPAX_Onec" real
);


ALTER TABLE public.student_dropouts OWNER TO postgres;

--
-- Name: student_term; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.student_term (
    "AcademicYear_Onec" integer,
    "Semester_Onec" integer,
    "DepartmentID_Onec" integer,
    "SchoolID_Onec" integer,
    "PersonID_Onec" text NOT NULL,
    "PassportNumber_Onec" text,
    "PrefixID_Onec" integer,
    "FirstName_Onec" text,
    "MiddleName_Onec" text,
    "LastName_Onec" text,
    "GenderID_Onec" integer,
    "NationalityID_Onec" integer,
    "DisabilityID_Onec" integer,
    "DisadvantageEducationID_Onec" integer,
    "VillageNumber_Onec" text,
    "Street_Onec" text,
    "Soi_Onec" text,
    "Trok_Onec" text,
    "SubDistrictID_Onec" integer,
    "SchoolAdmissionYear_Onec" integer,
    "GradeLevelID_Onec" integer,
    "RoomID_Onec" integer,
    "GPAX_Onec" real,
    "StudentStatusID_Onec" integer,
    "ProvinceNameThai_Onec" text,
    "DistrictNameThai_Onec" text,
    "SubDistrictNameThai_Onec" text
);


ALTER TABLE public.student_term OWNER TO postgres;

--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.system_settings (
    setting_key text NOT NULL,
    setting_value text NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer
);


ALTER TABLE public.system_settings OWNER TO postgres;

--
-- Name: task_links; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.task_links (
    id text NOT NULL,
    task_id text,
    parent_link_id text,
    token_hash text NOT NULL,
    magic_link text,
    delegation_depth integer DEFAULT 0,
    assigned_to_name text,
    assigned_to_phone text,
    assigned_to_email text,
    otp_code text,
    otp_expires_at timestamp with time zone,
    otp_verified integer DEFAULT 0,
    otp_attempts integer DEFAULT 0 NOT NULL,
    otp_locked_until timestamp with time zone,
    subject text,
    status text DEFAULT 'ACTIVE'::text,
    admin_locked integer DEFAULT 0,
    admin_lock_reason text,
    admin_lock_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    login_role text,
    login_permissions jsonb DEFAULT '[]'::jsonb,
    login_data_scope jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by integer
);


ALTER TABLE public.task_links OWNER TO postgres;

--
-- Name: task_submissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.task_submissions (
    id integer NOT NULL,
    task_link_id text,
    visit_lat real,
    visit_lng real,
    cause_category text,
    cause_detail text,
    photo_paths text,
    recommendation text,
    submitted_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    address_changed boolean DEFAULT false,
    updated_student_address text,
    updated_lat real,
    updated_lng real,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer
);


ALTER TABLE public.task_submissions OWNER TO postgres;

--
-- Name: task_submissions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.task_submissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.task_submissions_id_seq OWNER TO postgres;

--
-- Name: task_submissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.task_submissions_id_seq OWNED BY public.task_submissions.id;


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tasks (
    id text NOT NULL,
    case_id integer,
    status text DEFAULT 'PENDING'::text,
    max_delegation_depth integer DEFAULT 3,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    task_type text DEFAULT 'VISIT'::text,
    target_grade text,
    target_room text,
    target_school_id integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer
);


ALTER TABLE public.tasks OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username text NOT NULL,
    password text NOT NULL,
    affiliation text,
    status text DEFAULT 'ACTIVE'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "PersonID_Onec" text,
    phone text,
    email text,
    permissions jsonb DEFAULT '[]'::jsonb,
    "FirstName" text,
    "LastName" text,
    role text DEFAULT 'TEACHER'::text NOT NULL,
    data_scope jsonb DEFAULT '{}'::jsonb,
    must_change_password boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.users_id_seq OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: assistance_measures id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assistance_measures ALTER COLUMN id SET DEFAULT nextval('public.assistance_measures_id_seq'::regclass);


--
-- Name: attendance AttendanceID; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance ALTER COLUMN "AttendanceID" SET DEFAULT nextval('public."attendance_AttendanceID_seq"'::regclass);


--
-- Name: cases id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cases ALTER COLUMN id SET DEFAULT nextval('public.cases_id_seq'::regclass);


--
-- Name: dropout_reasons id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dropout_reasons ALTER COLUMN id SET DEFAULT nextval('public.dropout_reasons_id_seq'::regclass);


--
-- Name: educational_areas id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.educational_areas ALTER COLUMN id SET DEFAULT nextval('public.educational_areas_id_seq'::regclass);


--
-- Name: external_users ExternalID; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.external_users ALTER COLUMN "ExternalID" SET DEFAULT nextval('public."external_users_ExternalID_seq"'::regclass);


--
-- Name: migrations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.migrations ALTER COLUMN id SET DEFAULT nextval('public.migrations_id_seq'::regclass);


--
-- Name: related_agencies id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.related_agencies ALTER COLUMN id SET DEFAULT nextval('public.related_agencies_id_seq'::regclass);


--
-- Name: risk_factors id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.risk_factors ALTER COLUMN id SET DEFAULT nextval('public.risk_factors_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: schedules id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedules ALTER COLUMN id SET DEFAULT nextval('public.schedules_id_seq'::regclass);


--
-- Name: task_submissions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_submissions ALTER COLUMN id SET DEFAULT nextval('public.task_submissions_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Data for Name: assistance_measures; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.assistance_measures (id, label) FROM stdin;
\.


--
-- Data for Name: attendance; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.attendance ("AttendanceID", "PersonID_Onec", "SchoolID_Onec", "GradeLevelID_Onec", "RoomID_Onec", "AcademicYear_Onec", "Semester_Onec", "AttendanceDate", "Period", "AttendanceStatus", "RecordedAt", "RecordedBy", created_at, updated_at, created_by, updated_by) FROM stdin;
1	1-3066-30387-54-9	10010002	103	1	2569	1	2026-06-10	1	1	2026-06-10 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
2	1-3423-63781-38-3	10010002	103	1	2569	1	2026-06-10	1	1	2026-06-10 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
3	1-6431-21789-50-6	10010002	103	1	2569	1	2026-06-10	1	2	2026-06-10 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
4	1-6944-11296-19-6	10010002	103	1	2569	1	2026-06-10	1	1	2026-06-10 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
5	2-2841-72349-69-7	10010002	103	1	2569	1	2026-06-10	1	3	2026-06-10 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
6	2-7265-13314-26-8	10010002	103	1	2569	1	2026-06-10	1	1	2026-06-10 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
7	3-4695-96403-20-2	10010002	103	1	2569	1	2026-06-10	1	1	2026-06-10 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
8	3-5127-22418-86-6	10010002	103	1	2569	1	2026-06-10	1	2	2026-06-10 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
9	4-1553-45711-25-7	10010002	103	1	2569	1	2026-06-10	1	1	2026-06-10 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
10	4-3332-58929-79-3	10010002	103	1	2569	1	2026-06-10	1	1	2026-06-10 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
11	5-1453-84459-82-6	10010002	103	1	2569	1	2026-06-10	1	1	2026-06-10 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
12	5-3643-32359-12-2	10010002	103	1	2569	1	2026-06-10	1	3	2026-06-10 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
13	5-6711-76795-72-6	10010002	103	1	2569	1	2026-06-10	1	1	2026-06-10 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
14	6-1627-81568-35-6	10010002	103	1	2569	1	2026-06-10	1	1	2026-06-10 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
15	6-3280-99564-35-5	10010002	103	1	2569	1	2026-06-10	1	1	2026-06-10 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
16	6-5134-65797-53-5	10010002	103	1	2569	1	2026-06-10	1	1	2026-06-10 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
17	1-3066-30387-54-9	10010002	103	1	2569	1	2026-06-09	1	1	2026-06-09 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
18	1-3423-63781-38-3	10010002	103	1	2569	1	2026-06-09	1	2	2026-06-09 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
19	1-6431-21789-50-6	10010002	103	1	2569	1	2026-06-09	1	1	2026-06-09 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
20	1-6944-11296-19-6	10010002	103	1	2569	1	2026-06-09	1	1	2026-06-09 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
21	2-2841-72349-69-7	10010002	103	1	2569	1	2026-06-09	1	1	2026-06-09 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
22	2-7265-13314-26-8	10010002	103	1	2569	1	2026-06-09	1	3	2026-06-09 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
23	3-4695-96403-20-2	10010002	103	1	2569	1	2026-06-09	1	1	2026-06-09 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
24	3-5127-22418-86-6	10010002	103	1	2569	1	2026-06-09	1	1	2026-06-09 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
25	4-1553-45711-25-7	10010002	103	1	2569	1	2026-06-09	1	2	2026-06-09 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
26	4-3332-58929-79-3	10010002	103	1	2569	1	2026-06-09	1	1	2026-06-09 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
27	5-1453-84459-82-6	10010002	103	1	2569	1	2026-06-09	1	3	2026-06-09 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
28	5-3643-32359-12-2	10010002	103	1	2569	1	2026-06-09	1	1	2026-06-09 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
29	5-6711-76795-72-6	10010002	103	1	2569	1	2026-06-09	1	1	2026-06-09 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
30	6-1627-81568-35-6	10010002	103	1	2569	1	2026-06-09	1	2	2026-06-09 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
31	6-3280-99564-35-5	10010002	103	1	2569	1	2026-06-09	1	1	2026-06-09 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
32	6-5134-65797-53-5	10010002	103	1	2569	1	2026-06-09	1	1	2026-06-09 16:30:26.906096	seed_demo	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
\.


--
-- Data for Name: case_reviews; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.case_reviews (id, case_id, review_action, review_note, reviewed_by, reviewed_at, created_at, updated_at, created_by, updated_by) FROM stdin;
seed-review-1003	1003	CLOSE	ยืนยันการช่วยเหลือสำเร็จและปิดเคส	seed_director_10010002	2026-06-09 16:30:26.906096	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
seed-review-1004	1004	ASSIST	เห็นควรให้ความช่วยเหลือด้านค่าเดินทาง	seed_director_10010002	2026-06-10 04:30:26.906096	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
\.


--
-- Data for Name: cases; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.cases (id, student_name, student_school, student_address, student_lat, student_lng, reason_flagged, status, created_at, result_summary, updated_at, created_by, updated_by, student_id) FROM stdin;
1001	ประภา วิริยะ	โรงเรียนบ้านหนองขาม	บ้านเลขที่ 11 หมู่ 1 ต.ช้างมอย อ.เมืองเชียงใหม่ จ.เชียงใหม่	18.797	98.954	ขาดเรียนต่อเนื่อง 3 วันและติดต่อผู้ปกครองไม่ได้	OPEN	2026-06-09 16:30:26.906096+00	\N	2026-06-09 16:30:26.906096+00	\N	\N	\N
1002	จันทร์เพ็ญ พรประเสริฐ	โรงเรียนบ้านหนองขาม	บ้านเลขที่ 12 หมู่ 2 ต.สุเทพ อ.เมืองเชียงใหม่ จ.เชียงใหม่	18.799	98.956	มาเรียนไม่สม่ำเสมอและมีความเสี่ยงด้านเศรษฐกิจ	IN_PROGRESS	2026-06-08 16:30:26.906096+00	\N	2026-06-08 16:30:26.906096+00	\N	\N	\N
1003	ณัฐวรรธน์ จันทร์แก้ว	โรงเรียนบ้านหนองขาม	บ้านเลขที่ 13 หมู่ 3 ต.ศรีภูมิ อ.เมืองเชียงใหม่ จ.เชียงใหม่	18.801	98.958	ได้รับการช่วยเหลือค่าเดินทางและกลับมาเรียนปกติ	RESOLVED	2026-06-07 16:30:26.906096+00	ปิดเคสหลังติดตามครบถ้วน นักเรียนกลับมาเรียนต่อเนื่อง	2026-06-07 16:30:26.906096+00	\N	\N	\N
1004	ปัณณทัต ลือชา	โรงเรียนบ้านหนองขาม	บ้านเลขที่ 14 หมู่ 4 ต.หายยา อ.เมืองเชียงใหม่ จ.เชียงใหม่	18.803	98.96	รอผู้อำนวยการประเมินแนวทางช่วยเหลือ	PENDING_REVIEW	2026-06-06 16:30:26.906096+00	เจ้าหน้าที่ลงพื้นที่แล้ว รอผลประเมิน	2026-06-06 16:30:26.906096+00	\N	\N	\N
1005	ดิศรณ์ จันทร์แก้ว	โรงเรียนบ้านหนองขาม	บ้านเลขที่ 15 หมู่ 5 ต.ศรีภูมิ อ.เมืองเชียงใหม่ จ.เชียงใหม่	18.805	98.962	รอประสานหน่วยงานสวัสดิการในพื้นที่	AWAITING_HELP	2026-06-05 16:30:26.906096+00	\N	2026-06-05 16:30:26.906096+00	\N	\N	\N
1006	ภูมิพัฒน์ สกุลดี	โรงเรียนบ้านหนองขาม	บ้านเลขที่ 16 หมู่ 6 ต.ศรีภูมิ อ.เมืองเชียงใหม่ จ.เชียงใหม่	18.807	98.964	ครูประจำชั้นแจ้งพฤติกรรมเสี่ยงหลุดจากระบบ	OPEN	2026-06-04 16:30:26.906096+00	\N	2026-06-04 16:30:26.906096+00	\N	\N	\N
\.


--
-- Data for Name: dropout_reasons; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.dropout_reasons (id, label) FROM stdin;
\.


--
-- Data for Name: educational_areas; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.educational_areas (id, name) FROM stdin;
\.


--
-- Data for Name: external_users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.external_users ("ExternalID", "PersonID_Onec", "FullName", created_at) FROM stdin;
\.


--
-- Data for Name: grade_levels; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.grade_levels (id, label, category) FROM stdin;
101	ป.1	ประถมศึกษา
102	ป.2	ประถมศึกษา
103	ป.3	ประถมศึกษา
104	ป.4	ประถมศึกษา
105	ป.5	ประถมศึกษา
106	ป.6	ประถมศึกษา
111	ม.1	มัธยมศึกษาตอนต้น
112	ม.2	มัธยมศึกษาตอนต้น
113	ม.3	มัธยมศึกษาตอนต้น
421	ม.4	มัธยมศึกษาตอนปลาย
422	ม.5	มัธยมศึกษาตอนปลาย
423	ม.6	มัธยมศึกษาตอนปลาย
\.


--
-- Data for Name: migrations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.migrations (id, "timestamp", name) FROM stdin;
1	260328145500	CreateBaselineSchema20260328145500
2	20260610090000	AddMustChangePasswordToUsers20260610090000
3	260612000000	AddStudentIdToCases20260612000000
4	260613120000	AddSetUpdatedAtFunction20260613120000
5	260613130000	AddAuditColumnsPhase2a20260613130000
\.


--
-- Data for Name: related_agencies; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.related_agencies (id, name) FROM stdin;
\.


--
-- Data for Name: risk_factors; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.risk_factors (id, label) FROM stdin;
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.roles (id, name, label, rank, default_permissions, scope_mode, is_system, created_at, updated_at, created_by, updated_by) FROM stdin;
1	ADMIN	ผู้ดูแลระบบ	9	["home", "dashboard", "students", "create", "attendance", "attendance-dashboard", "manage-users-list", "manage-role-groups", "login-links", "settings", "import-data"]	flexible	t	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
98	ADMIN_PROVINCE	แอดมินระดับจังหวัด	8	["home", "dashboard", "students", "create", "attendance", "attendance-dashboard", "manage-users-list", "login-links"]	province	t	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
99	ADMIN_DISTRICT	แอดมินระดับอำเภอ	7	["home", "dashboard", "students", "create", "attendance", "attendance-dashboard", "manage-users-list", "login-links"]	district	t	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
100	ADMIN_SUBDISTRICT	แอดมินระดับตำบล	6	["home", "dashboard", "students", "create", "attendance", "attendance-dashboard", "manage-users-list", "login-links"]	sub_district	t	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
101	ADMIN_SCHOOL	แอดมินระดับโรงเรียน	5	["home", "dashboard", "students", "create", "attendance", "attendance-dashboard", "manage-users-list", "login-links"]	school	t	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
2	DIRECTOR	ผู้อำนวยการ	4	["home", "dashboard", "students", "create", "attendance", "attendance-dashboard", "manage-users-list", "login-links", "settings"]	flexible	t	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
24	EXECUTIVE	ผู้บริหาร	3	["home", "dashboard", "students", "attendance-dashboard"]	flexible	t	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
105	STUDENT	นักเรียน	1	["home", "student-self"]	flexible	t	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
3	TEACHER	คุณครู	2	["home", "students", "attendance"]	flexible	t	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
\.


--
-- Data for Name: schedules; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.schedules (id, grade, room, day_of_week, subject, start_time, end_time, teacher) FROM stdin;
\.


--
-- Data for Name: schools; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.schools (id, name, province, district, sub_district, created_at, updated_at, created_by, updated_by) FROM stdin;
10010001	โรงเรียนอนุบาลวัดกลาง	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
10010002	โรงเรียนบ้านหนองขาม	เชียงใหม่	เมืองเชียงใหม่	สุเทพ	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
10010003	โรงเรียนสาธิตมหาวิทยาลัย	ขอนแก่น	เมืองขอนแก่น	ในเมือง	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
10010004	โรงเรียนเทพศิรินทร์ราชดำริ	กรุงเทพมหานคร	ดอนเมือง	สีกัน	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
10010005	โรงเรียนเตรียมอุดมภาคภูมิ	อุดรธานี	เมืองอุดรธานี	บ้านขาว	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
10010006	โรงเรียนอรรถวิทย์รังสรรค์	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
10010007	โรงเรียนประชานุกูลประสิทธิ์	เชียงราย	เมืองเชียงราย	บ้านดู่	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
10010008	โรงเรียนศึกษาวิสุทธิ์	นครปฐม	เมืองนครปฐม	พระประโทน	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
10010009	โรงเรียนดรุณศึกษาธิการ	ตรัง	เมืองตรัง	บ้านควน	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
10010010	โรงเรียนมัธยมวิทยาคุณ	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
\.


--
-- Data for Name: student_dropouts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.student_dropouts ("ProvinceNameThai_Onec", "DistrictNameThai_Onec", "SubDistrictNameThai_Onec", "PersonID_Onec", "Fullname_Onec", "Gender_Onec", "NationalityName_Onec", "BirthDate_Onec", "HouseNumber_Onec", "VillageNumber_Onec", "Street_Onec", "Soi_Onec", "Trok_Onec", "StatusCodeCause_Onec", "Remark_Onec", "SchoolName_Onec", "GradeLevelID_Onec", "AcademicYearPresent_Onec", "DropoutTransferID_Onec", "ACADYEAR", "RoomID_Onec", "SchoolID_Onec", "GenderID_Onec", "GPAX_Onec") FROM stdin;
กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์	7-9465-36823-67-6	สุรชัย ศักดิ์สิทธิ์	ชาย	ไทย	2014-02-03	610	5	ถนนมิตรภาพ	\N	\N	2	ยากจน	โรงเรียนอนุบาลวัดกลาง	105	2569	0	2569	3	10010001	1	2.54
กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง	2-1705-53029-58-5	ดวงใจ แสงสว่าง	หญิง	ไทย	2015-08-07	43	7	ถ.ประชาสามัคคี	\N	\N	2	ยากจน	โรงเรียนอนุบาลวัดกลาง	103	2569	0	2569	2	10010001	2	2.15
กรุงเทพมหานคร	พระนคร	วัดราชบพิธ	1-9795-74937-99-5	ประพันธ์ พรประเสริฐ	ชาย	ไทย	2012-05-22	857/97	6	ถนนสุขุมวิท	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอนุบาลวัดกลาง	111	2569	0	2569	2	10010001	1	1.24
กรุงเทพมหานคร	พระนคร	สำราญราษฎร์	3-2570-49869-81-2	ศิริพร รุ่งเรือง	หญิง	ไทย	2013-11-10	584/22	5	ถนนรัตนาธิเบศร์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอนุบาลวัดกลาง	105	2569	0	2569	2	10010001	2	1.45
กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง	7-1824-16611-91-3	ธัชพล เกียรติสกุล	ชาย	ไทย	2013-11-28	726/55	6	ถนนอุดรดุษฎี	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอนุบาลวัดกลาง	105	2569	0	2569	2	10010001	1	2.8
กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์	2-8595-81192-94-2	รชานนท์ เจริญชัย	ชาย	ไทย	2015-11-06	870/87	1	ถนนนวมินทร์	\N	\N	2	ยากจน	โรงเรียนอนุบาลวัดกลาง	103	2569	0	2569	3	10010001	1	2.62
กรุงเทพมหานคร	พระนคร	สำราญราษฎร์	3-2908-20085-84-4	ทิพย์สุดา สีดา	หญิง	ไทย	2008-07-25	838	9	ถ.รัฐพัฒนา	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	422	2569	0	2569	2	10010001	2	1.54
กรุงเทพมหานคร	พระนคร	สำราญราษฎร์	5-5374-50410-70-2	อภิญญา วงษ์สุวรรณ	หญิง	ไทย	2015-06-27	552/38	2	ถนนสีลม	\N	\N	2	ยากจน	โรงเรียนอนุบาลวัดกลาง	103	2569	0	2569	3	10010001	2	1.87
กรุงเทพมหานคร	พระนคร	สำราญราษฎร์	4-6200-52936-91-8	สิรภพ ทองดี	ชาย	ไทย	2009-02-23	104/60	1	ถนนสาทร	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	113	2569	0	2569	1	10010001	1	2.28
กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์	6-4754-53913-37-3	วรพล สมบูรณ์	ชาย	ไทย	2006-03-07	737	2	ถนนราษฎร์บูรณะ	\N	\N	2	ยากจน	โรงเรียนอนุบาลวัดกลาง	423	2569	0	2569	2	10010001	1	2.41
กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง	6-7422-64056-15-1	จิราพร สุดสวย	หญิง	ไทย	2016-11-03	726/71	6	ถนนนิมมานเหมินท์	\N	\N	2	ยากจน	โรงเรียนอนุบาลวัดกลาง	103	2569	0	2569	1	10010001	2	2.01
กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์	1-3534-59260-21-6	วรากร วังขวา	ชาย	ไทย	2017-10-13	379	5	ถนนชัยพฤกษ์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	102	2569	0	2569	2	10010001	1	1.16
กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง	6-3234-78346-78-8	รุ่งอรุณ วงษ์สุวรรณ	หญิง	ไทย	2007-10-07	417/56	9	ถนนโชคชัย	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	422	2569	0	2569	1	10010001	2	1.56
กรุงเทพมหานคร	พระนคร	วัดราชบพิธ	6-2790-75786-57-5	สมศักดิ์ สุจริต	ชาย	ไทย	2014-10-02	752	5	ถนนเพชรเกษม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	105	2569	0	2569	1	10010001	1	1.69
กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง	2-5963-44358-81-9	นันทพร ปัญญาดี	หญิง	ไทย	2009-04-20	416	7	ถนนอุดรดุษฎี	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	113	2569	0	2569	3	10010001	2	1.3
กรุงเทพมหานคร	พระนคร	วัดราชบพิธ	8-6394-34145-62-6	ธนาธิป คงพิทักษ์	ชาย	ไทย	2013-01-11	896	8	ถนนลาดพร้าว	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอนุบาลวัดกลาง	106	2569	0	2569	1	10010001	1	1.62
กรุงเทพมหานคร	พระนคร	วัดราชบพิธ	4-3392-91490-92-1	สุนิสา บุญมี	หญิง	ไทย	2010-12-18	728	9	ถนนบรมราชชนนี	\N	\N	2	ยากจน	โรงเรียนอนุบาลวัดกลาง	113	2569	0	2569	3	10010001	2	2.55
กรุงเทพมหานคร	พระนคร	สำราญราษฎร์	4-6349-93554-65-2	ภัคพล ทองดี	ชาย	ไทย	2007-09-02	200/42	2	ถนนพหลโยธิน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	423	2569	0	2569	1	10010001	1	2.11
กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์	1-7871-90593-75-7	วุฒิพงษ์ หอมหวาน	ชาย	ไทย	2008-10-12	38/92	8	ถ.รัฐพัฒนา	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	422	2569	0	2569	3	10010001	1	2.44
กรุงเทพมหานคร	พระนคร	วัดราชบพิธ	4-5652-75107-63-5	ลลิตา วงษ์สุวรรณ	หญิง	ไทย	2013-01-05	916	10	ถนนงามวงศ์วาน	\N	\N	2	ยากจน	โรงเรียนอนุบาลวัดกลาง	106	2569	0	2569	3	10010001	2	1.25
กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง	1-6126-88184-89-1	เกวลิน บริบูรณ์	หญิง	ไทย	2010-01-19	367/28	3	ถนนบายพาส	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอนุบาลวัดกลาง	113	2569	0	2569	2	10010001	2	1.61
กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง	4-1412-76739-69-1	วรพล สุดสวย	ชาย	ไทย	2012-04-09	245/21	5	ถนนมาลัยแมน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	106	2569	0	2569	2	10010001	1	1.17
กรุงเทพมหานคร	พระนคร	สำราญราษฎร์	5-2470-17422-75-1	สุนิสา เพียรดี	หญิง	ไทย	2009-03-06	638	2	ถนนพหลโยธิน	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอนุบาลวัดกลาง	421	2569	0	2569	2	10010001	2	1.01
กรุงเทพมหานคร	พระนคร	สำราญราษฎร์	6-6755-25132-53-8	สุทธิพงษ์ นิ่มนวล	ชาย	ไทย	2007-03-21	37	5	ถนนอ่อนนุช	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	423	2569	0	2569	2	10010001	1	1.32
กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง	6-9066-92046-15-6	กวินท์ พรสวรรค์	ชาย	ไทย	2017-11-10	904	4	ถนนนิมมานเหมินท์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	102	2569	0	2569	3	10010001	1	1.42
กรุงเทพมหานคร	พระนคร	สำราญราษฎร์	4-7590-83204-53-4	นลินทิพย์ ยิ้มแย้ม	หญิง	ไทย	2010-10-19	578	3	ถนนโชคชัย	\N	\N	2	ยากจน	โรงเรียนอนุบาลวัดกลาง	112	2569	0	2569	2	10010001	2	1.11
กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์	2-2045-57694-27-6	วีรชัย ชูศรี	ชาย	ไทย	2008-12-02	429/13	7	ถนนมิตรภาพ	\N	\N	2	ยากจน	โรงเรียนอนุบาลวัดกลาง	422	2569	0	2569	1	10010001	1	2.77
กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง	7-7975-58464-22-5	วิมลรัตน์ คงมั่น	หญิง	ไทย	2006-08-21	524/72	3	ถ.รัฐพัฒนา	\N	\N	2	ยากจน	โรงเรียนอนุบาลวัดกลาง	423	2569	0	2569	1	10010001	2	1.53
กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์	3-3541-46502-19-2	สุนิสา งามดี	หญิง	ไทย	2015-10-02	486	6	ถนนมิตรภาพ	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	104	2569	0	2569	3	10010001	2	1.11
กรุงเทพมหานคร	พระนคร	สำราญราษฎร์	2-2707-54848-26-2	ภัคพล กิตติคุณ	ชาย	ไทย	2014-04-26	785	10	ถนนราษฎร์บูรณะ	\N	\N	2	ยากจน	โรงเรียนอนุบาลวัดกลาง	104	2569	0	2569	2	10010001	1	2.7
กรุงเทพมหานคร	พระนคร	สำราญราษฎร์	6-6963-23128-39-2	รชานนท์ สุขสบาย	ชาย	ไทย	2009-08-24	25	10	ถนนนวมินทร์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	421	2569	0	2569	2	10010001	1	1.85
กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง	8-6828-59653-67-5	กุลธิดา ชัยมงคล	หญิง	ไทย	2008-10-29	321/93	8	ถนนลาดพร้าว	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	421	2569	0	2569	3	10010001	2	1.41
กรุงเทพมหานคร	พระนคร	สำราญราษฎร์	6-2112-66974-13-4	ปาณิสรา รักษ์ไทย	หญิง	ไทย	2016-01-11	113/80	2	ถนนนิมมานเหมินท์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	103	2569	0	2569	2	10010001	2	1.91
กรุงเทพมหานคร	พระนคร	วัดราชบพิธ	1-5011-28088-71-5	เอกพงษ์ ดีสมัย	ชาย	ไทย	2009-03-22	106/56	5	ถนนศรีนครินทร์	\N	\N	2	ยากจน	โรงเรียนอนุบาลวัดกลาง	113	2569	0	2569	1	10010001	1	2.51
กรุงเทพมหานคร	พระนคร	สำราญราษฎร์	3-1154-71644-48-5	ทิพย์สุดา ดำรงค์	หญิง	ไทย	2015-05-20	81	5	ถนนเจริญกรุง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	103	2569	0	2569	2	10010001	2	2.62
กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์	5-6294-35223-76-2	ไกรวุฒิ ปัญญาดี	ชาย	ไทย	2008-05-13	776/74	2	ถนนอุดรดุษฎี	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	422	2569	0	2569	2	10010001	1	2.15
กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง	4-7929-81041-67-1	กันตภณ สุดสวย	ชาย	ไทย	2018-12-06	68	2	ถนนกลางเมือง	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอนุบาลวัดกลาง	101	2569	0	2569	3	10010001	1	2.04
กรุงเทพมหานคร	พระนคร	วัดราชบพิธ	1-1989-51646-42-4	ปิยังกูร หอมหวาน	ชาย	ไทย	2008-04-22	658/86	3	ถนนสรงประภา	\N	\N	2	ยากจน	โรงเรียนอนุบาลวัดกลาง	422	2569	0	2569	1	10010001	1	2.43
กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์	5-6881-14480-38-9	สุดารัตน์ ชูศรี	หญิง	ไทย	2015-08-15	592	5	ถ.เอกชัย	\N	\N	2	ยากจน	โรงเรียนอนุบาลวัดกลาง	103	2569	0	2569	2	10010001	2	1.3
กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์	4-8748-72306-92-5	เพ็ญพักตร์ ชูศรี	หญิง	ไทย	2012-07-06	795/82	7	ถ.ประชาสามัคคี	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	106	2569	0	2569	1	10010001	2	2.53
กรุงเทพมหานคร	พระนคร	วัดราชบพิธ	5-7628-27610-59-1	วิมลรัตน์ ศักดิ์สิทธิ์	หญิง	ไทย	2013-09-05	331/65	6	ถนนมิตรภาพ	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	105	2569	0	2569	2	10010001	2	1.52
กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง	8-8523-99659-42-5	ดรุณี ชูศรี	หญิง	ไทย	2017-10-13	763	6	ถนนประดิษฐ์มนูธรรม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	102	2569	0	2569	2	10010001	2	2.68
กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง	4-3373-20745-33-2	สมศักดิ์ คงพิทักษ์	ชาย	ไทย	2016-05-06	876	7	ถนนเพชรเกษม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	102	2569	0	2569	3	10010001	1	2.58
กรุงเทพมหานคร	พระนคร	สำราญราษฎร์	2-1493-29399-91-9	สุนิสา บุญมี	หญิง	ไทย	2012-04-03	652	4	ถนนเพชรเกษม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	106	2569	0	2569	1	10010001	2	2.51
กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง	8-5643-90047-79-9	ชนิดา พรสวรรค์	หญิง	ไทย	2016-10-30	677	8	ถนนงามวงศ์วาน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	103	2569	0	2569	1	10010001	2	2.79
กรุงเทพมหานคร	พระนคร	วัดราชบพิธ	1-1938-81011-58-7	ปาณิสรา พรประเสริฐ	หญิง	ไทย	2013-02-07	421/84	2	ถนนห้วยแก้ว	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	105	2569	0	2569	1	10010001	2	2.57
กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์	7-5522-66282-83-6	วีรชัย รักษ์ไทย	ชาย	ไทย	2015-09-05	274	5	ถนนอุดรดุษฎี	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอนุบาลวัดกลาง	103	2569	0	2569	2	10010001	1	2.76
กรุงเทพมหานคร	พระนคร	วัดราชบพิธ	4-3462-58262-69-2	ธนภัทร เกียรติสกุล	ชาย	ไทย	2014-06-20	419/83	10	ถนนรัตนาธิเบศร์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	105	2569	0	2569	2	10010001	1	1.84
กรุงเทพมหานคร	พระนคร	วัดราชบพิธ	3-1651-88908-88-7	รัตนาภรณ์ รุ่งเรือง	หญิง	ไทย	2008-05-11	428/18	6	ถนนลาดพร้าว	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	421	2569	0	2569	2	10010001	2	1.38
กรุงเทพมหานคร	พระนคร	วัดราชบพิธ	3-3135-29101-71-3	วรากร บุญมี	ชาย	ไทย	2017-01-13	696/42	10	ถนนสีลม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอนุบาลวัดกลาง	101	2569	0	2569	1	10010001	1	1.86
เชียงใหม่	เมืองเชียงใหม่	สุเทพ	4-5474-16961-54-4	วาสนา ชัยมงคล	หญิง	ไทย	2010-04-28	554/62	7	ถ.ประชาสามัคคี	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนบ้านหนองขาม	113	2569	0	2569	2	10010002	2	2.67
เชียงใหม่	เมืองเชียงใหม่	พระสิงห์	7-8791-28557-81-1	ณัฐวรรธน์ ดีสมัย	ชาย	ไทย	2011-10-07	208	2	ถนนเยาวราช	\N	\N	2	ยากจน	โรงเรียนบ้านหนองขาม	112	2569	0	2569	3	10010002	1	2.02
เชียงใหม่	เมืองเชียงใหม่	พระสิงห์	8-9622-29089-32-4	วันวิสา เกียรติสกุล	หญิง	ไทย	2017-04-01	656	10	ถ.รัฐพัฒนา	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	101	2569	0	2569	1	10010002	2	2.78
เชียงใหม่	เมืองเชียงใหม่	ช้างมอย	4-7495-50951-49-2	พิพัฒน์ แสงสว่าง	ชาย	ไทย	2011-06-05	278	8	ถ.บ้านโป่ง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	111	2569	0	2569	2	10010002	1	2.12
เชียงใหม่	เมืองเชียงใหม่	หายยา	4-7210-77554-10-9	เกวลิน ดำรงค์	หญิง	ไทย	2007-08-03	595	9	ถนนรัตนาธิเบศร์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	423	2569	0	2569	3	10010002	2	1.9
เชียงใหม่	เมืองเชียงใหม่	ช้างมอย	2-8795-56575-55-3	ดิศรณ์ มณีรัตน์	ชาย	ไทย	2011-09-05	835/91	4	ถนนงามวงศ์วาน	\N	\N	2	ยากจน	โรงเรียนบ้านหนองขาม	112	2569	0	2569	3	10010002	1	1.53
เชียงใหม่	เมืองเชียงใหม่	หายยา	4-1832-81315-83-8	ทัศนัย สุวรรณภูมิ	ชาย	ไทย	2012-05-21	945/94	8	ถนนมาลัยแมน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	106	2569	0	2569	1	10010002	1	2.62
เชียงใหม่	เมืองเชียงใหม่	พระสิงห์	2-6549-75654-36-7	สุรชัย พรประเสริฐ	ชาย	ไทย	2010-02-27	214/91	10	ถนนสรงประภา	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	112	2569	0	2569	3	10010002	1	1.24
เชียงใหม่	เมืองเชียงใหม่	หายยา	7-1369-48271-74-9	ปิยนุช ทั่วถึง	หญิง	ไทย	2012-04-21	534/51	3	ถนนประดิษฐ์มนูธรรม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	111	2569	0	2569	3	10010002	2	2.73
เชียงใหม่	เมืองเชียงใหม่	ช้างมอย	5-8614-18533-78-9	กวินท์ สีดา	ชาย	ไทย	2012-01-07	530/86	7	ถนนมิตรภาพ	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	106	2569	0	2569	1	10010002	1	2.24
เชียงใหม่	เมืองเชียงใหม่	พระสิงห์	4-1255-68554-42-7	ศุภณัฐ ชูศรี	ชาย	ไทย	2016-10-09	820	7	ถนนสาทร	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนบ้านหนองขาม	102	2569	0	2569	3	10010002	1	1.73
เชียงใหม่	เมืองเชียงใหม่	ช้างมอย	2-3814-69175-68-5	วิมลรัตน์ เจริญชัย	หญิง	ไทย	2016-03-03	635/55	6	ถนนห้วยแก้ว	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนบ้านหนองขาม	102	2569	0	2569	3	10010002	2	2.24
เชียงใหม่	เมืองเชียงใหม่	พระสิงห์	2-5664-94009-25-9	วิชญ์พล คงพิทักษ์	ชาย	ไทย	2017-02-23	957	6	ถนนมาลัยแมน	\N	\N	2	ยากจน	โรงเรียนบ้านหนองขาม	102	2569	0	2569	1	10010002	1	1.06
เชียงใหม่	เมืองเชียงใหม่	พระสิงห์	3-1768-14561-40-8	ปัณณทัต คงมั่น	ชาย	ไทย	2010-11-22	144	5	ถ.บ้านโป่ง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	113	2569	0	2569	1	10010002	1	1.72
เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ	5-6360-58120-28-1	สุภัสสรา สีดา	หญิง	ไทย	2009-01-01	651/45	10	ถนนราษฎร์บูรณะ	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	421	2569	0	2569	3	10010002	2	1.09
เชียงใหม่	เมืองเชียงใหม่	สุเทพ	3-3543-64472-40-1	ประพันธ์ ลือชา	ชาย	ไทย	2007-02-04	963	1	ถ.บ้านโป่ง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	422	2569	0	2569	3	10010002	1	2.05
เชียงใหม่	เมืองเชียงใหม่	ช้างมอย	5-7598-23237-28-6	วสันต์ กิตติคุณ	ชาย	ไทย	2017-10-19	662	10	ถนนนวมินทร์	\N	\N	2	ยากจน	โรงเรียนบ้านหนองขาม	102	2569	0	2569	3	10010002	1	1.27
เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ	1-4263-16750-79-3	อนุชา เพ็งพา	ชาย	ไทย	2014-07-14	696	6	ถนนสุดสาคร	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนบ้านหนองขาม	104	2569	0	2569	1	10010002	1	1.76
เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ	1-9337-11932-46-1	ศุภณัฐ พันธุ์ดี	ชาย	ไทย	2017-06-24	165	7	ถนนงามวงศ์วาน	\N	\N	2	ยากจน	โรงเรียนบ้านหนองขาม	101	2569	0	2569	2	10010002	1	1.38
เชียงใหม่	เมืองเชียงใหม่	สุเทพ	3-4591-46128-57-5	บุษยา จันทร์แก้ว	หญิง	ไทย	2016-12-08	141	4	ถนนบรมราชชนนี	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนบ้านหนองขาม	103	2569	0	2569	3	10010002	2	1.45
เชียงใหม่	เมืองเชียงใหม่	ช้างมอย	5-3623-72275-63-6	แสงดาว กิตติคุณ	หญิง	ไทย	2009-04-23	668	8	ถนนสุขุมวิท	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	113	2569	0	2569	2	10010002	2	2.44
เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ	6-1901-98914-27-2	นันทพร ใจดี	หญิง	ไทย	2006-09-18	291/3	7	ถนนรามคำแหง	\N	\N	2	ยากจน	โรงเรียนบ้านหนองขาม	423	2569	0	2569	1	10010002	2	1.39
เชียงใหม่	เมืองเชียงใหม่	หายยา	3-1107-13252-97-5	ชลธิชา ทองดี	หญิง	ไทย	2007-02-04	775/17	5	ถนนเยาวราช	\N	\N	2	ยากจน	โรงเรียนบ้านหนองขาม	423	2569	0	2569	2	10010002	2	1.61
เชียงใหม่	เมืองเชียงใหม่	ช้างมอย	8-1040-91868-29-4	วีรชัย จันทร์แก้ว	ชาย	ไทย	2008-11-10	764	8	ถนนเจริญกรุง	\N	\N	2	ยากจน	โรงเรียนบ้านหนองขาม	421	2569	0	2569	1	10010002	1	1.45
เชียงใหม่	เมืองเชียงใหม่	ช้างมอย	1-7072-36698-48-3	วสันต์ อินทร์ชัย	ชาย	ไทย	2015-09-07	363	2	ถ.บ้านโป่ง	\N	\N	2	ยากจน	โรงเรียนบ้านหนองขาม	103	2569	0	2569	1	10010002	1	1.79
เชียงใหม่	เมืองเชียงใหม่	สุเทพ	3-2978-58942-57-6	ชินดนัย พรสวรรค์	ชาย	ไทย	2006-11-21	138/74	10	ถนนสุรวงศ์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนบ้านหนองขาม	423	2569	0	2569	1	10010002	1	2.54
เชียงใหม่	เมืองเชียงใหม่	ช้างมอย	1-6057-19014-23-3	สุภัสสรา คงมั่น	หญิง	ไทย	2017-04-15	909	3	ถนนบายพาส	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	101	2569	0	2569	1	10010002	2	2.57
เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ	1-3241-84910-59-8	มานพ เพียรดี	ชาย	ไทย	2007-10-17	274	10	ถ.เอกชัย	\N	\N	2	ยากจน	โรงเรียนบ้านหนองขาม	423	2569	0	2569	2	10010002	1	2.24
เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ	4-5979-81276-40-6	ชินดนัย พันธุ์ดี	ชาย	ไทย	2008-07-18	372	10	ถนนสุขุมวิท	\N	\N	2	ยากจน	โรงเรียนบ้านหนองขาม	421	2569	0	2569	3	10010002	1	2.44
เชียงใหม่	เมืองเชียงใหม่	ช้างมอย	6-7716-48246-76-7	ลลิตา ขาวสะอาด	หญิง	ไทย	2010-03-27	259/20	5	ถนนสุดสาคร	\N	\N	2	ยากจน	โรงเรียนบ้านหนองขาม	112	2569	0	2569	3	10010002	2	1.19
เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ	7-1031-86864-88-4	พรทิพย์ จันทร์แก้ว	หญิง	ไทย	2010-10-12	721	3	ถนนบายพาส	\N	\N	2	ยากจน	โรงเรียนบ้านหนองขาม	113	2569	0	2569	1	10010002	2	2.66
เชียงใหม่	เมืองเชียงใหม่	ช้างมอย	5-9395-27696-42-1	กุลธิดา แสงสว่าง	หญิง	ไทย	2008-06-02	115	6	ถนนชัยพฤกษ์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	421	2569	0	2569	1	10010002	2	1.04
เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ	8-4906-36961-98-3	สิริมา บุญรอด	หญิง	ไทย	2016-02-21	292	2	ถนนช้างเผือก	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนบ้านหนองขาม	102	2569	0	2569	3	10010002	2	1.94
เชียงใหม่	เมืองเชียงใหม่	สุเทพ	8-4833-90553-17-4	ชาตรี ศักดิ์สิทธิ์	ชาย	ไทย	2009-09-22	106	10	ถ.ประชาสามัคคี	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนบ้านหนองขาม	421	2569	0	2569	1	10010002	1	2.27
เชียงใหม่	เมืองเชียงใหม่	สุเทพ	4-5736-39998-20-1	ปิยังกูร สง่างาม	ชาย	ไทย	2010-01-14	933	9	ถนนมิตรภาพ	\N	\N	2	ยากจน	โรงเรียนบ้านหนองขาม	113	2569	0	2569	3	10010002	1	1.07
เชียงใหม่	เมืองเชียงใหม่	สุเทพ	7-8557-54526-97-9	ดวงใจ คงมั่น	หญิง	ไทย	2014-02-08	836	1	ถนนบรมราชชนนี	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนบ้านหนองขาม	105	2569	0	2569	2	10010002	2	2.58
เชียงใหม่	เมืองเชียงใหม่	ช้างมอย	6-7131-72340-68-3	นันทพร เพียรดี	หญิง	ไทย	2016-11-08	36	1	ถนนห้วยแก้ว	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	103	2569	0	2569	3	10010002	2	2.12
เชียงใหม่	เมืองเชียงใหม่	สุเทพ	7-5479-38927-50-4	รชานนท์ สง่างาม	ชาย	ไทย	2010-06-22	863	1	ถนนเพชรเกษม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	113	2569	0	2569	3	10010002	1	2
เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ	5-5133-20097-18-6	ศิริพร รุ่งเรือง	หญิง	ไทย	2011-12-14	227	10	ถนนเพชรเกษม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	112	2569	0	2569	1	10010002	2	2.57
เชียงใหม่	เมืองเชียงใหม่	ช้างมอย	7-3479-75099-26-5	สุมาลี แสงสว่าง	หญิง	ไทย	2010-07-18	981	8	ถนนพหลโยธิน	\N	\N	2	ยากจน	โรงเรียนบ้านหนองขาม	112	2569	0	2569	3	10010002	2	1.32
เชียงใหม่	เมืองเชียงใหม่	ช้างมอย	4-3541-56743-27-7	กาญจนา หอมหวาน	หญิง	ไทย	2012-01-14	693/47	6	ถ.ประชาสามัคคี	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	106	2569	0	2569	2	10010002	2	1.78
เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ	1-1594-56887-63-6	สุนิสา เพียรดี	หญิง	ไทย	2009-05-06	703/32	1	ถนนเยาวราช	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	113	2569	0	2569	1	10010002	2	2.51
เชียงใหม่	เมืองเชียงใหม่	สุเทพ	3-8362-11264-70-6	สุมาลี นามมนตรี	หญิง	ไทย	2015-10-05	621	4	ถนนมิตรภาพ	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	104	2569	0	2569	3	10010002	2	1.96
เชียงใหม่	เมืองเชียงใหม่	หายยา	3-5045-29712-79-1	ศิวกร เพ็งพา	ชาย	ไทย	2015-07-26	100	2	ถนนลาดพร้าว	\N	\N	2	ยากจน	โรงเรียนบ้านหนองขาม	104	2569	0	2569	2	10010002	1	2
เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ	4-9905-37649-84-6	วุฒิพงษ์ พรประเสริฐ	ชาย	ไทย	2017-12-06	788/36	6	ถ.บ้านโป่ง	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนบ้านหนองขาม	102	2569	0	2569	3	10010002	1	1.78
เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ	5-2017-58248-80-9	ปรเมศวร์ สุขสันต์	ชาย	ไทย	2009-10-19	476	5	ถนนบรมราชชนนี	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	113	2569	0	2569	3	10010002	1	2.36
เชียงใหม่	เมืองเชียงใหม่	พระสิงห์	4-6352-23351-82-6	รัฐนนท์ ศักดิ์สิทธิ์	ชาย	ไทย	2008-04-17	54	3	ถนนอ่อนนุช	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	422	2569	0	2569	1	10010002	1	1.42
เชียงใหม่	เมืองเชียงใหม่	สุเทพ	4-9913-40736-41-4	อภิญญา มณีรัตน์	หญิง	ไทย	2008-01-08	216	9	ถ.บ้านโป่ง	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนบ้านหนองขาม	422	2569	0	2569	1	10010002	2	2.35
เชียงใหม่	เมืองเชียงใหม่	หายยา	6-9253-18889-46-9	ณัฐวุฒิ ทั่วถึง	ชาย	ไทย	2009-03-02	550/79	6	ถนนงามวงศ์วาน	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนบ้านหนองขาม	113	2569	0	2569	2	10010002	1	1.29
เชียงใหม่	เมืองเชียงใหม่	หายยา	3-8579-36071-16-1	สุนิสา กิตติคุณ	หญิง	ไทย	2014-02-18	426/38	8	ถนนลาดพร้าว	\N	\N	1	ปัญหาครอบครัว	โรงเรียนบ้านหนองขาม	105	2569	0	2569	2	10010002	2	2.52
ขอนแก่น	เมืองขอนแก่น	ในเมือง	2-3308-91334-47-5	วรรณภา พันธุ์ดี	หญิง	ไทย	2016-06-27	454	4	ถ.รัฐพัฒนา	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	103	2569	0	2569	2	10010003	2	2.67
ขอนแก่น	เมืองขอนแก่น	ในเมือง	1-4263-69465-65-1	ธนพัฒน์ มณีรัตน์	ชาย	ไทย	2014-04-05	939/14	10	ถนนเพชรเกษม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนสาธิตมหาวิทยาลัย	105	2569	0	2569	3	10010003	1	1.44
ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม	8-4546-23067-12-9	จิตรลดา ดำรงค์	หญิง	ไทย	2010-01-22	54	8	ถนนงามวงศ์วาน	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	112	2569	0	2569	1	10010003	2	2.04
ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม	2-1151-42664-29-3	รัตนาภรณ์ ปัญญาดี	หญิง	ไทย	2015-11-22	138/29	9	ถนนโชคชัย	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	103	2569	0	2569	2	10010003	2	1.94
ขอนแก่น	เมืองขอนแก่น	เมืองเก่า	5-2307-86241-51-8	นพรัตน์ ประสิทธิ์ผล	ชาย	ไทย	2011-01-31	164	2	ถนนมาลัยแมน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนสาธิตมหาวิทยาลัย	111	2569	0	2569	3	10010003	1	2.11
ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม	4-7389-84259-75-2	วันวิสา วิริยะ	หญิง	ไทย	2008-10-14	641/45	4	ถนนนิมมานเหมินท์	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	422	2569	0	2569	1	10010003	2	2.26
ขอนแก่น	เมืองขอนแก่น	พระลับ	4-1681-80742-18-1	พรทิพย์ พันธุ์ดี	หญิง	ไทย	2010-10-20	483	10	ถนนสีลม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนสาธิตมหาวิทยาลัย	112	2569	0	2569	2	10010003	2	2.62
ขอนแก่น	เมืองขอนแก่น	พระลับ	8-3760-60880-68-5	จิราพร สุวรรณภูมิ	หญิง	ไทย	2016-08-17	874	6	ถนนสุรวงศ์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนสาธิตมหาวิทยาลัย	102	2569	0	2569	3	10010003	2	1.05
ขอนแก่น	เมืองขอนแก่น	พระลับ	8-1480-95633-33-8	ทักษิณ เจริญชัย	ชาย	ไทย	2015-11-21	101/18	8	ถนนสุรวงศ์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนสาธิตมหาวิทยาลัย	103	2569	0	2569	2	10010003	1	2.02
ขอนแก่น	เมืองขอนแก่น	พระลับ	8-2805-59848-81-2	วรพล บุญมี	ชาย	ไทย	2011-07-24	198	9	ถนนอ่อนนุช	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	111	2569	0	2569	2	10010003	1	1.2
ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม	6-1203-34639-50-8	วุฒิพงษ์ วิริยะ	ชาย	ไทย	2016-01-30	963	4	ถนนกลางเมือง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนสาธิตมหาวิทยาลัย	102	2569	0	2569	2	10010003	1	1.54
ขอนแก่น	เมืองขอนแก่น	สาวะถี	6-8756-91040-60-2	วรากร งามดี	ชาย	ไทย	2017-12-22	318	5	ถนนสุขุมวิท	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนสาธิตมหาวิทยาลัย	102	2569	0	2569	1	10010003	1	2.4
ขอนแก่น	เมืองขอนแก่น	พระลับ	2-6586-32465-30-8	พรรษา ชูศรี	หญิง	ไทย	2009-05-14	728	2	ถนนรามคำแหง	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนสาธิตมหาวิทยาลัย	421	2569	0	2569	1	10010003	2	1.55
ขอนแก่น	เมืองขอนแก่น	ในเมือง	4-1158-33527-93-1	สุดารัตน์ สกุลดี	หญิง	ไทย	2012-12-15	27	7	ถนนมิตรภาพ	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	106	2569	0	2569	3	10010003	2	1.67
ขอนแก่น	เมืองขอนแก่น	สาวะถี	3-3426-46506-69-1	ชินดนัย เพ็งพา	ชาย	ไทย	2017-11-07	268/38	9	ถนนห้วยแก้ว	\N	\N	1	ปัญหาครอบครัว	โรงเรียนสาธิตมหาวิทยาลัย	101	2569	0	2569	1	10010003	1	2.16
ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม	4-3306-17001-12-9	ชินดนัย ประสิทธิ์ผล	ชาย	ไทย	2010-05-22	325	9	ถ.ประชาสามัคคี	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	112	2569	0	2569	2	10010003	1	1.04
ขอนแก่น	เมืองขอนแก่น	เมืองเก่า	7-6020-38797-22-1	วรากร ดำรงค์	ชาย	ไทย	2014-06-13	129	3	ถนนสุขุมวิท	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนสาธิตมหาวิทยาลัย	104	2569	0	2569	3	10010003	1	1.54
ขอนแก่น	เมืองขอนแก่น	สาวะถี	2-8703-78289-64-3	อัมพร อ่อนน้อม	หญิง	ไทย	2013-06-16	14	10	ถนนศรีนครินทร์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนสาธิตมหาวิทยาลัย	106	2569	0	2569	2	10010003	2	1.65
ขอนแก่น	เมืองขอนแก่น	สาวะถี	1-9067-44754-28-7	เพ็ญพักตร์ ดีสมัย	หญิง	ไทย	2014-07-24	515	2	ถ.ประชาสามัคคี	\N	\N	1	ปัญหาครอบครัว	โรงเรียนสาธิตมหาวิทยาลัย	105	2569	0	2569	2	10010003	2	2.03
ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม	1-4611-94494-19-7	ชนะชัย บริบูรณ์	ชาย	ไทย	2010-12-23	906	9	ถนนรามคำแหง	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	112	2569	0	2569	2	10010003	1	2.52
ขอนแก่น	เมืองขอนแก่น	ในเมือง	7-1109-25170-32-1	กุลธิดา สกุลดี	หญิง	ไทย	2011-11-15	20/3	9	ถนนรามคำแหง	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนสาธิตมหาวิทยาลัย	111	2569	0	2569	3	10010003	2	2.78
ขอนแก่น	เมืองขอนแก่น	เมืองเก่า	6-5862-47857-14-9	สุมาลี แสงสว่าง	หญิง	ไทย	2007-11-11	554	6	ถนนพหลโยธิน	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	422	2569	0	2569	1	10010003	2	1.61
ขอนแก่น	เมืองขอนแก่น	ในเมือง	1-9519-95623-48-9	รัตนาภรณ์ ใจดี	หญิง	ไทย	2008-07-28	136	7	ถนนสุขุมวิท	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	421	2569	0	2569	3	10010003	2	2.55
ขอนแก่น	เมืองขอนแก่น	เมืองเก่า	5-4613-28197-31-2	สุนิสา เพ็งพา	หญิง	ไทย	2018-07-18	376	4	ถนนวิภาวดีรังสิต	\N	\N	1	ปัญหาครอบครัว	โรงเรียนสาธิตมหาวิทยาลัย	101	2569	0	2569	1	10010003	2	2.53
ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม	2-6618-46917-70-5	สุนิสา มงคล	หญิง	ไทย	2009-05-27	937/22	10	ถนนมิตรภาพ	\N	\N	1	ปัญหาครอบครัว	โรงเรียนสาธิตมหาวิทยาลัย	113	2569	0	2569	2	10010003	2	2.48
ขอนแก่น	เมืองขอนแก่น	สาวะถี	6-5136-19426-34-1	มณีรัตน์ วิไลวรรณ	หญิง	ไทย	2015-06-26	920	5	ถนนเยาวราช	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	104	2569	0	2569	1	10010003	2	1.06
ขอนแก่น	เมืองขอนแก่น	ในเมือง	3-4040-26179-28-4	สุทธิพงษ์ กิตติคุณ	ชาย	ไทย	2008-05-15	695	1	ถนนสีลม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนสาธิตมหาวิทยาลัย	421	2569	0	2569	1	10010003	1	2.61
ขอนแก่น	เมืองขอนแก่น	เมืองเก่า	7-1497-17588-91-6	คุณากร วิริยะ	ชาย	ไทย	2010-09-15	143/98	2	ถนนสุขุมวิท	\N	\N	1	ปัญหาครอบครัว	โรงเรียนสาธิตมหาวิทยาลัย	113	2569	0	2569	3	10010003	1	2.22
ขอนแก่น	เมืองขอนแก่น	เมืองเก่า	8-6525-34658-27-4	ภัทรวดี มณีรัตน์	หญิง	ไทย	2012-08-20	563/86	8	ถ.เอกชัย	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	111	2569	0	2569	1	10010003	2	2.24
ขอนแก่น	เมืองขอนแก่น	เมืองเก่า	8-3628-32187-75-1	สุมาลี พันธุ์ดี	หญิง	ไทย	2015-04-30	833	4	ถนนสุดสาคร	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนสาธิตมหาวิทยาลัย	103	2569	0	2569	3	10010003	2	1.6
ขอนแก่น	เมืองขอนแก่น	สาวะถี	7-2455-86192-20-9	กวินท์ ทั่วถึง	ชาย	ไทย	2013-07-11	55	9	ถนนเพชรเกษม	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนสาธิตมหาวิทยาลัย	105	2569	0	2569	2	10010003	1	2.64
ขอนแก่น	เมืองขอนแก่น	เมืองเก่า	8-1159-13163-42-2	ชนิดา ชัยมงคล	หญิง	ไทย	2006-05-15	939/95	4	ถนนสีลม	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	423	2569	0	2569	2	10010003	2	2.15
ขอนแก่น	เมืองขอนแก่น	ในเมือง	3-9040-71799-93-1	นพรัตน์ เจริญชัย	ชาย	ไทย	2013-03-22	250	10	ถนนสีลม	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	105	2569	0	2569	3	10010003	1	2.59
ขอนแก่น	เมืองขอนแก่น	เมืองเก่า	1-4995-66599-51-8	บุญยิ่ง อินทร์ชัย	ชาย	ไทย	2007-11-08	78	9	ถ.บ้านโป่ง	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนสาธิตมหาวิทยาลัย	423	2569	0	2569	1	10010003	1	1.46
ขอนแก่น	เมืองขอนแก่น	ในเมือง	6-5449-11478-57-8	วรากร คงพิทักษ์	ชาย	ไทย	2017-03-19	772/67	8	ถนนสุขุมวิท	\N	\N	1	ปัญหาครอบครัว	โรงเรียนสาธิตมหาวิทยาลัย	101	2569	0	2569	1	10010003	1	1.98
ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม	1-8769-90280-33-4	อนุชา กิตติคุณ	ชาย	ไทย	2017-05-10	146	4	ถนนสุรวงศ์	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	102	2569	0	2569	2	10010003	1	1.52
ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม	1-8570-31837-59-7	ธัชพล รักษ์ไทย	ชาย	ไทย	2014-01-26	839	4	ถนนรามคำแหง	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	104	2569	0	2569	3	10010003	1	1.72
ขอนแก่น	เมืองขอนแก่น	ในเมือง	6-4632-88842-55-7	วาสนา สง่างาม	หญิง	ไทย	2012-06-26	219	9	ถ.บ้านโป่ง	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนสาธิตมหาวิทยาลัย	106	2569	0	2569	2	10010003	2	1.78
ขอนแก่น	เมืองขอนแก่น	พระลับ	4-5160-28684-59-3	ปรเมศวร์ หอมหวาน	ชาย	ไทย	2014-10-27	420/40	5	ถนนนิมมานเหมินท์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนสาธิตมหาวิทยาลัย	104	2569	0	2569	3	10010003	1	2.06
ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม	7-1178-19197-86-4	ธนภัทร หอมหวาน	ชาย	ไทย	2016-01-19	653	3	ถนนประดิษฐ์มนูธรรม	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	102	2569	0	2569	2	10010003	1	1.61
ขอนแก่น	เมืองขอนแก่น	พระลับ	4-6072-54362-99-8	ชนิดา อ่อนน้อม	หญิง	ไทย	2012-02-18	852/60	2	ถ.รัฐพัฒนา	\N	\N	1	ปัญหาครอบครัว	โรงเรียนสาธิตมหาวิทยาลัย	111	2569	0	2569	3	10010003	2	2.42
ขอนแก่น	เมืองขอนแก่น	สาวะถี	3-3187-36434-19-5	รชานนท์ สุวรรณภูมิ	ชาย	ไทย	2012-02-08	908	5	ถนนชัยพฤกษ์	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	106	2569	0	2569	1	10010003	1	1.55
ขอนแก่น	เมืองขอนแก่น	เมืองเก่า	7-8457-55751-76-2	ธนภัทร มีสุข	ชาย	ไทย	2012-01-02	708/30	5	ถนนกาญจนาภิเษก	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนสาธิตมหาวิทยาลัย	111	2569	0	2569	2	10010003	1	1.78
ขอนแก่น	เมืองขอนแก่น	สาวะถี	7-7682-98232-41-8	วันวิสา เจริญชัย	หญิง	ไทย	2006-06-22	563	7	ถนนรามคำแหง	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	423	2569	0	2569	1	10010003	2	2.27
ขอนแก่น	เมืองขอนแก่น	เมืองเก่า	5-1934-43103-89-6	สิรภพ สุวรรณภูมิ	ชาย	ไทย	2009-05-20	937	7	ถนนราษฎร์บูรณะ	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	421	2569	0	2569	2	10010003	1	1.87
ขอนแก่น	เมืองขอนแก่น	ในเมือง	7-6625-33262-88-3	เอกพงษ์ คงพิทักษ์	ชาย	ไทย	2007-05-08	467	2	ถนนอ่อนนุช	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	422	2569	0	2569	2	10010003	1	2.19
ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม	4-4261-82895-40-6	สิรภพ สุจริต	ชาย	ไทย	2009-01-12	807	3	ถ.รัฐพัฒนา	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	113	2569	0	2569	3	10010003	1	1.87
ขอนแก่น	เมืองขอนแก่น	สาวะถี	5-2470-39951-50-1	รุ่งอรุณ เพ็งพา	หญิง	ไทย	2008-01-30	198	10	ถ.ประชาสามัคคี	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนสาธิตมหาวิทยาลัย	422	2569	0	2569	3	10010003	2	2.56
ขอนแก่น	เมืองขอนแก่น	ในเมือง	1-7305-74708-72-4	กัญญาณัฐ ขาวสะอาด	หญิง	ไทย	2016-06-29	896	6	ถนนศรีนครินทร์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนสาธิตมหาวิทยาลัย	102	2569	0	2569	3	10010003	2	1.13
ขอนแก่น	เมืองขอนแก่น	เมืองเก่า	6-6607-79657-46-8	เจษฎา สง่างาม	ชาย	ไทย	2007-11-14	787/39	1	ถนนพหลโยธิน	\N	\N	2	ยากจน	โรงเรียนสาธิตมหาวิทยาลัย	422	2569	0	2569	3	10010003	1	1.22
กรุงเทพมหานคร	ดอนเมือง	สีกัน	1-8840-65458-62-8	วรากร สุขสันต์	ชาย	ไทย	2018-01-01	536/13	10	ถนนนวมินทร์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	101	2569	0	2569	2	10010004	1	1.3
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	4-3012-15990-66-5	วิมลรัตน์ สุวรรณภูมิ	หญิง	ไทย	2014-09-07	449/25	2	ถนนลาดพร้าว	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	104	2569	0	2569	2	10010004	2	1.82
กรุงเทพมหานคร	ดอนเมือง	สีกัน	5-2297-45401-49-2	พรรษา ดีสมัย	หญิง	ไทย	2008-01-12	169	6	ถ.เอกชัย	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	422	2569	0	2569	3	10010004	2	2.04
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	4-6424-31488-56-2	ธนาธิป บริบูรณ์	ชาย	ไทย	2015-02-28	159/80	9	ถ.รัฐพัฒนา	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	103	2569	0	2569	2	10010004	1	2.52
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	8-6796-99589-80-8	สุดารัตน์ ทั่วถึง	หญิง	ไทย	2012-05-25	45	2	ถนนสรงประภา	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	111	2569	0	2569	3	10010004	2	1.02
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	2-7420-35710-78-7	นพรัตน์ บริบูรณ์	ชาย	ไทย	2017-07-16	76/2	9	ถนนอ่อนนุช	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	101	2569	0	2569	1	10010004	1	2.67
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	8-1358-15936-51-7	ประพันธ์ ดีสมัย	ชาย	ไทย	2013-11-21	915/69	7	ถนนอ่อนนุช	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	106	2569	0	2569	3	10010004	1	2.56
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	5-5306-67482-46-7	กัญญาณัฐ คงพิทักษ์	หญิง	ไทย	2011-05-24	636/47	8	ถนนราษฎร์บูรณะ	\N	\N	2	ยากจน	โรงเรียนเทพศิรินทร์ราชดำริ	111	2569	0	2569	1	10010004	2	2.46
กรุงเทพมหานคร	ดอนเมือง	สีกัน	7-9832-55123-35-9	บุญยิ่ง สีดา	ชาย	ไทย	2017-07-09	621/42	7	ถนนสรงประภา	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	102	2569	0	2569	3	10010004	1	1.58
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	2-9911-95242-84-3	สุภัสสรา คงพิทักษ์	หญิง	ไทย	2012-03-25	475	10	ถนนประดิษฐ์มนูธรรม	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	106	2569	0	2569	3	10010004	2	1.72
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	4-8621-88193-88-6	สุนิสา วิริยะ	หญิง	ไทย	2011-08-06	393	1	ถนนเจริญกรุง	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	112	2569	0	2569	2	10010004	2	1.82
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	5-9613-72388-80-7	อัมพร สุวรรณภูมิ	หญิง	ไทย	2015-05-02	767/67	1	ถนนรามคำแหง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	103	2569	0	2569	1	10010004	2	2.78
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	7-5987-26209-10-3	สุภัสสรา อ่อนน้อม	หญิง	ไทย	2017-06-01	150	1	ถนนกลางเมือง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	102	2569	0	2569	3	10010004	2	2.19
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	4-6675-27572-58-3	ณัฐวุฒิ ชูศรี	ชาย	ไทย	2013-10-13	744	4	ถนนนวมินทร์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	106	2569	0	2569	1	10010004	1	1.94
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	7-3379-57993-10-2	จิราพร ปัญญาดี	หญิง	ไทย	2018-03-23	896	10	ถนนราษฎร์บูรณะ	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	101	2569	0	2569	2	10010004	2	1.82
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	6-8163-17875-58-4	ชนะชัย นิ่มนวล	ชาย	ไทย	2007-07-06	743/18	4	ถนนอุดรดุษฎี	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	423	2569	0	2569	2	10010004	1	2.1
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	1-2342-83767-71-4	ธัชพล สุดสวย	ชาย	ไทย	2013-12-04	123/99	3	ถนนสุขุมวิท	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	106	2569	0	2569	3	10010004	1	2.71
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	8-5839-97676-96-2	เจษฎา เพ็งพา	ชาย	ไทย	2015-04-27	634	4	ถนนประดิษฐ์มนูธรรม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	103	2569	0	2569	3	10010004	1	2.72
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	6-9831-61776-41-6	บุญยิ่ง มีสุข	ชาย	ไทย	2014-08-18	298	3	ถนนสุรวงศ์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	104	2569	0	2569	1	10010004	1	2.09
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	7-7167-39224-85-1	อัมพร บุญมี	หญิง	ไทย	2013-06-05	890	5	ถนนสรงประภา	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	105	2569	0	2569	3	10010004	2	2.07
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	3-9646-13539-11-3	อัมพร คงมั่น	หญิง	ไทย	2015-05-29	844/61	1	ถนนมาลัยแมน	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	104	2569	0	2569	1	10010004	2	1.15
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	4-7382-24752-30-4	วรากร พันธุ์ดี	ชาย	ไทย	2017-04-14	603/71	2	ถนนประดิษฐ์มนูธรรม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	102	2569	0	2569	3	10010004	1	2.24
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	6-2330-99339-53-3	เกวลิน ยิ้มแย้ม	หญิง	ไทย	2014-11-15	247	6	ถนนประดิษฐ์มนูธรรม	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	105	2569	0	2569	3	10010004	2	2.67
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	3-3178-99381-38-8	นันทพร สุวรรณภูมิ	หญิง	ไทย	2018-01-27	838	1	ถนนสุขุมวิท	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	101	2569	0	2569	1	10010004	2	1.14
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	2-6390-98597-39-4	ปัณณทัต ขาวสะอาด	ชาย	ไทย	2011-11-16	592	9	ถนนสีลม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	111	2569	0	2569	1	10010004	1	2.09
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	2-9278-50414-93-9	บุญยิ่ง สกุลดี	ชาย	ไทย	2012-02-10	628/50	5	ถนนช้างเผือก	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	106	2569	0	2569	3	10010004	1	1.21
กรุงเทพมหานคร	ดอนเมือง	สีกัน	2-4324-47226-62-9	ปัณณทัต มงคล	ชาย	ไทย	2007-02-23	756/81	1	ถนนบายพาส	\N	\N	2	ยากจน	โรงเรียนเทพศิรินทร์ราชดำริ	422	2569	0	2569	2	10010004	1	1.84
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	7-8946-33575-37-5	ชลธิชา รักษ์ไทย	หญิง	ไทย	2017-11-19	870/56	9	ถนนนวมินทร์	\N	\N	2	ยากจน	โรงเรียนเทพศิรินทร์ราชดำริ	102	2569	0	2569	3	10010004	2	1.85
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	7-8966-17250-66-4	ศิริพร รักษ์ไทย	หญิง	ไทย	2010-12-13	845	3	ถนนเพชรเกษม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	112	2569	0	2569	3	10010004	2	1.99
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	3-4267-75326-83-6	วรพล งามดี	ชาย	ไทย	2010-09-21	251	5	ถนนสรงประภา	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	113	2569	0	2569	3	10010004	1	1.2
กรุงเทพมหานคร	ดอนเมือง	สีกัน	6-3815-61904-67-6	ชาตรี รุ่งเรือง	ชาย	ไทย	2012-05-29	985/23	10	ถนนนวมินทร์	\N	\N	2	ยากจน	โรงเรียนเทพศิรินทร์ราชดำริ	111	2569	0	2569	1	10010004	1	1.4
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	1-5403-92170-65-1	นลินทิพย์ อ่อนน้อม	หญิง	ไทย	2017-07-19	846	2	ถนนพหลโยธิน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	101	2569	0	2569	1	10010004	2	1.02
กรุงเทพมหานคร	ดอนเมือง	สีกัน	8-3778-61809-44-7	สุทธิพงษ์ วังขวา	ชาย	ไทย	2008-12-15	147	7	ถ.รัฐพัฒนา	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	421	2569	0	2569	2	10010004	1	2.12
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	2-7049-75187-30-4	ธนภัทร เกียรติสกุล	ชาย	ไทย	2008-09-07	594	3	ถนนเยาวราช	\N	\N	2	ยากจน	โรงเรียนเทพศิรินทร์ราชดำริ	421	2569	0	2569	2	10010004	1	2.51
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	6-9056-50548-64-6	นันทพร อ่อนน้อม	หญิง	ไทย	2013-07-07	92	5	ถนนอุดรดุษฎี	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	106	2569	0	2569	3	10010004	2	2.12
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	3-9379-87222-43-9	นภาพร คงมั่น	หญิง	ไทย	2006-04-23	983	9	ถนนนิมมานเหมินท์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	423	2569	0	2569	1	10010004	2	2.43
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	3-9227-11364-96-9	อรณิชา สกุลดี	หญิง	ไทย	2015-12-10	165	2	ถนนนิมมานเหมินท์	\N	\N	2	ยากจน	โรงเรียนเทพศิรินทร์ราชดำริ	104	2569	0	2569	1	10010004	2	1.24
กรุงเทพมหานคร	ดอนเมือง	สีกัน	1-5749-31194-95-7	บุญยิ่ง รักษ์ไทย	ชาย	ไทย	2012-06-01	588	1	ถนนนวมินทร์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	106	2569	0	2569	2	10010004	1	2.18
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	8-9263-53143-93-1	ณัฐวุฒิ พงษ์ไพร	ชาย	ไทย	2014-01-22	773	7	ถนนงามวงศ์วาน	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	105	2569	0	2569	1	10010004	1	1
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	2-8119-94619-33-7	ชัยชนะ รักษ์ไทย	ชาย	ไทย	2017-04-15	433	10	ถนนโชคชัย	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	102	2569	0	2569	2	10010004	1	2.19
กรุงเทพมหานคร	ดอนเมือง	สีกัน	5-5989-50845-61-2	ประภา บุญมี	หญิง	ไทย	2015-08-31	94	6	ถนนนิมมานเหมินท์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	103	2569	0	2569	3	10010004	2	2.66
กรุงเทพมหานคร	ดอนเมือง	สีกัน	5-5195-94361-99-5	วันวิสา บริบูรณ์	หญิง	ไทย	2017-11-27	666	6	ถนนอ่อนนุช	\N	\N	2	ยากจน	โรงเรียนเทพศิรินทร์ราชดำริ	102	2569	0	2569	2	10010004	2	2.4
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	4-2213-40047-29-2	สิรภพ ชัยมงคล	ชาย	ไทย	2017-12-04	859	2	ถนนบายพาส	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	102	2569	0	2569	2	10010004	1	2.62
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	1-1956-73777-26-7	พิพัฒน์ ปัญญาดี	ชาย	ไทย	2008-04-16	64	7	ถนนโชคชัย	\N	\N	2	ยากจน	โรงเรียนเทพศิรินทร์ราชดำริ	421	2569	0	2569	3	10010004	1	2.5
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	1-6513-82249-46-5	ชลธิชา รุ่งเรือง	หญิง	ไทย	2013-02-28	356/18	9	ถนนราษฎร์บูรณะ	\N	\N	2	ยากจน	โรงเรียนเทพศิรินทร์ราชดำริ	105	2569	0	2569	2	10010004	2	1.52
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	7-8086-47187-86-8	ทักษิณ หอมหวาน	ชาย	ไทย	2016-07-02	167	9	ถนนสุรวงศ์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	103	2569	0	2569	1	10010004	1	1.14
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	2-4586-37016-73-6	จิตรลดา วิไลวรรณ	หญิง	ไทย	2010-11-04	595	4	ถนนสีลม	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	112	2569	0	2569	2	10010004	2	1.66
กรุงเทพมหานคร	ดอนเมือง	สนามบิน	2-7509-87468-42-7	กัญญา สมบูรณ์	หญิง	ไทย	2015-07-16	764	6	ถนนอุดรดุษฎี	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	104	2569	0	2569	3	10010004	2	1.9
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	7-9505-14198-70-3	ทัศนัย คงพิทักษ์	ชาย	ไทย	2007-07-06	338	10	ถ.ประชาสามัคคี	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเทพศิรินทร์ราชดำริ	422	2569	0	2569	2	10010004	1	2.44
กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง	7-3476-23622-37-7	ชินดนัย วงษ์สุวรรณ	ชาย	ไทย	2012-10-12	837/19	10	ถนนวิภาวดีรังสิต	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเทพศิรินทร์ราชดำริ	106	2569	0	2569	3	10010004	1	1.76
อุดรธานี	เมืองอุดรธานี	บ้านจั่น	6-8969-61091-86-9	อภิญญา บริบูรณ์	หญิง	ไทย	2007-07-07	791	6	ถนนงามวงศ์วาน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเตรียมอุดมภาคภูมิ	422	2569	0	2569	1	10010005	2	1.56
อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์	4-8071-13951-18-5	ปิยนุช ชูศรี	หญิง	ไทย	2015-11-22	965/15	6	ถ.รัฐพัฒนา	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเตรียมอุดมภาคภูมิ	104	2569	0	2569	2	10010005	2	1.4
อุดรธานี	เมืองอุดรธานี	บ้านขาว	7-2286-44527-14-8	สุทธิพงษ์ หอมหวาน	ชาย	ไทย	2007-10-07	465	2	ถนนโชคชัย	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเตรียมอุดมภาคภูมิ	422	2569	0	2569	2	10010005	1	1.65
อุดรธานี	เมืองอุดรธานี	บ้านขาว	3-4621-32846-27-8	อภิวัฒน์ เจริญชัย	ชาย	ไทย	2013-01-30	416	8	ถนนอ่อนนุช	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเตรียมอุดมภาคภูมิ	105	2569	0	2569	3	10010005	1	2.73
อุดรธานี	เมืองอุดรธานี	หมากแข้ง	6-4624-26961-94-7	ณัฐวุฒิ ธนาคาร	ชาย	ไทย	2010-07-04	95	10	ถนนงามวงศ์วาน	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเตรียมอุดมภาคภูมิ	112	2569	0	2569	2	10010005	1	1.78
อุดรธานี	เมืองอุดรธานี	หนองบัว	3-3721-68591-85-2	ดรุณี ดำรงค์	หญิง	ไทย	2015-10-17	530	6	ถนนห้วยแก้ว	\N	\N	2	ยากจน	โรงเรียนเตรียมอุดมภาคภูมิ	104	2569	0	2569	2	10010005	2	1.62
อุดรธานี	เมืองอุดรธานี	หนองบัว	4-1074-91948-27-7	วรรณภา แสงสว่าง	หญิง	ไทย	2007-03-02	669/45	7	ถนนสุรวงศ์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเตรียมอุดมภาคภูมิ	423	2569	0	2569	1	10010005	2	1.87
อุดรธานี	เมืองอุดรธานี	บ้านจั่น	3-8262-21162-94-3	ปาณิสรา แสงสว่าง	หญิง	ไทย	2009-04-08	765	9	ถนนศรีนครินทร์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเตรียมอุดมภาคภูมิ	421	2569	0	2569	2	10010005	2	2.35
อุดรธานี	เมืองอุดรธานี	บ้านจั่น	3-7125-49295-15-8	รัฐนนท์ มณีรัตน์	ชาย	ไทย	2007-08-05	505	5	ถนนนวมินทร์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเตรียมอุดมภาคภูมิ	423	2569	0	2569	3	10010005	1	1.82
อุดรธานี	เมืองอุดรธานี	บ้านขาว	2-3211-70516-72-4	รชานนท์ วิริยะ	ชาย	ไทย	2015-01-11	116	8	ถนนวิภาวดีรังสิต	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเตรียมอุดมภาคภูมิ	103	2569	0	2569	3	10010005	1	1.29
อุดรธานี	เมืองอุดรธานี	บ้านขาว	8-3622-45389-27-8	ณัฐวรรธน์ ลือชา	ชาย	ไทย	2010-09-11	358	2	ถนนกาญจนาภิเษก	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเตรียมอุดมภาคภูมิ	113	2569	0	2569	1	10010005	1	1.86
อุดรธานี	เมืองอุดรธานี	หนองบัว	6-4512-24088-64-5	ชนิดา สุขสันต์	หญิง	ไทย	2017-12-06	452/79	5	ถนนประดิษฐ์มนูธรรม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเตรียมอุดมภาคภูมิ	101	2569	0	2569	3	10010005	2	2.49
อุดรธานี	เมืองอุดรธานี	หมากแข้ง	4-3949-80461-91-5	เกวลิน ดีสมัย	หญิง	ไทย	2006-10-04	354/70	9	ถนนสุรวงศ์	\N	\N	2	ยากจน	โรงเรียนเตรียมอุดมภาคภูมิ	423	2569	0	2569	1	10010005	2	2.16
อุดรธานี	เมืองอุดรธานี	หมากแข้ง	3-9936-25693-82-5	คุณากร ใจดี	ชาย	ไทย	2008-05-06	58/33	10	ถ.เอกชัย	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเตรียมอุดมภาคภูมิ	422	2569	0	2569	2	10010005	1	1.99
อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์	4-6851-77387-80-5	สมหญิง ยิ้มแย้ม	หญิง	ไทย	2008-09-10	350/5	9	ถนนมาลัยแมน	\N	\N	2	ยากจน	โรงเรียนเตรียมอุดมภาคภูมิ	421	2569	0	2569	2	10010005	2	1.8
อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์	2-7675-75494-60-5	นรวิชญ์ วิริยะ	ชาย	ไทย	2007-05-25	463/67	4	ถนนสุรวงศ์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเตรียมอุดมภาคภูมิ	422	2569	0	2569	2	10010005	1	2.24
อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์	8-1144-62308-96-8	นภาพร พงษ์ไพร	หญิง	ไทย	2010-06-13	512	4	ถนนลาดพร้าว	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเตรียมอุดมภาคภูมิ	113	2569	0	2569	3	10010005	2	1.3
อุดรธานี	เมืองอุดรธานี	หมากแข้ง	1-3292-37820-65-9	ธัญชนก ชูศรี	หญิง	ไทย	2009-11-17	92	5	ถนนอุดรดุษฎี	\N	\N	2	ยากจน	โรงเรียนเตรียมอุดมภาคภูมิ	113	2569	0	2569	1	10010005	2	2.5
อุดรธานี	เมืองอุดรธานี	หมากแข้ง	7-2167-27121-19-5	รุ่งอรุณ พงษ์ไพร	หญิง	ไทย	2015-01-20	749	2	ถนนศรีนครินทร์	\N	\N	2	ยากจน	โรงเรียนเตรียมอุดมภาคภูมิ	103	2569	0	2569	3	10010005	2	2.46
อุดรธานี	เมืองอุดรธานี	บ้านจั่น	5-2977-93959-93-5	ปิยังกูร อ่อนน้อม	ชาย	ไทย	2008-02-29	835	3	ถนนมาลัยแมน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเตรียมอุดมภาคภูมิ	422	2569	0	2569	3	10010005	1	1.19
อุดรธานี	เมืองอุดรธานี	บ้านขาว	1-3901-10823-33-4	แสงดาว จันทร์แก้ว	หญิง	ไทย	2017-06-28	95/83	3	ถนนเพชรเกษม	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเตรียมอุดมภาคภูมิ	102	2569	0	2569	3	10010005	2	2.69
อุดรธานี	เมืองอุดรธานี	บ้านขาว	2-5874-40331-51-8	สุทธิพงษ์ รุ่งเรือง	ชาย	ไทย	2016-06-08	803/99	10	ถนนเจริญกรุง	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเตรียมอุดมภาคภูมิ	102	2569	0	2569	1	10010005	1	1.28
อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์	7-6542-82437-49-6	ชนิดา ลือชา	หญิง	ไทย	2016-05-09	429/88	5	ถนนมิตรภาพ	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเตรียมอุดมภาคภูมิ	103	2569	0	2569	2	10010005	2	1.09
อุดรธานี	เมืองอุดรธานี	หมากแข้ง	2-6257-44187-90-1	เอกพงษ์ เกียรติสกุล	ชาย	ไทย	2015-03-19	851	6	ถนนราษฎร์บูรณะ	\N	\N	2	ยากจน	โรงเรียนเตรียมอุดมภาคภูมิ	104	2569	0	2569	1	10010005	1	1.59
อุดรธานี	เมืองอุดรธานี	หนองบัว	3-4043-39731-96-5	จันทร์เพ็ญ ลือชา	หญิง	ไทย	2016-10-10	765	8	ถนนเพชรเกษม	\N	\N	2	ยากจน	โรงเรียนเตรียมอุดมภาคภูมิ	103	2569	0	2569	3	10010005	2	1.23
อุดรธานี	เมืองอุดรธานี	บ้านจั่น	5-4984-13320-94-8	อภิญญา รุ่งเรือง	หญิง	ไทย	2017-11-04	404	7	ถ.ประชาสามัคคี	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเตรียมอุดมภาคภูมิ	102	2569	0	2569	3	10010005	2	1.25
อุดรธานี	เมืองอุดรธานี	หนองบัว	5-8605-97641-92-7	สมหญิง สุขสบาย	หญิง	ไทย	2017-04-12	933/77	6	ถนนอ่อนนุช	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเตรียมอุดมภาคภูมิ	101	2569	0	2569	2	10010005	2	2.68
อุดรธานี	เมืองอุดรธานี	บ้านขาว	5-8777-60150-55-3	ณัฐนิชา มีสุข	หญิง	ไทย	2016-05-29	900/87	6	ถนนบายพาส	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเตรียมอุดมภาคภูมิ	102	2569	0	2569	1	10010005	2	1.99
อุดรธานี	เมืองอุดรธานี	หนองบัว	2-5766-92806-40-8	ณัฐวรรธน์ ขาวสะอาด	ชาย	ไทย	2010-05-08	106/37	6	ถนนเจริญกรุง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเตรียมอุดมภาคภูมิ	112	2569	0	2569	1	10010005	1	1.34
อุดรธานี	เมืองอุดรธานี	หมากแข้ง	1-8531-85751-68-6	วรรณภา ชูศรี	หญิง	ไทย	2011-02-06	797	3	ถนนราษฎร์บูรณะ	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเตรียมอุดมภาคภูมิ	111	2569	0	2569	1	10010005	2	1.82
อุดรธานี	เมืองอุดรธานี	บ้านจั่น	2-9381-85781-35-1	วาสนา สุขสบาย	หญิง	ไทย	2012-02-24	724	7	ถนนอ่อนนุช	\N	\N	2	ยากจน	โรงเรียนเตรียมอุดมภาคภูมิ	111	2569	0	2569	3	10010005	2	2.49
อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์	2-4900-51510-53-7	วาสนา นามมนตรี	หญิง	ไทย	2016-03-10	373	8	ถนนชัยพฤกษ์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเตรียมอุดมภาคภูมิ	103	2569	0	2569	3	10010005	2	1.79
อุดรธานี	เมืองอุดรธานี	บ้านขาว	5-8601-59812-33-4	กัญญา ศรีสุข	หญิง	ไทย	2008-05-31	522/51	8	ถนนรัตนาธิเบศร์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเตรียมอุดมภาคภูมิ	422	2569	0	2569	3	10010005	2	1.21
อุดรธานี	เมืองอุดรธานี	บ้านจั่น	7-5562-19521-76-2	สุนิสา ใจดี	หญิง	ไทย	2010-03-13	270	1	ถนนเยาวราช	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเตรียมอุดมภาคภูมิ	113	2569	0	2569	3	10010005	2	1.87
อุดรธานี	เมืองอุดรธานี	บ้านจั่น	3-9498-13869-94-3	อภิวัฒน์ ชูศรี	ชาย	ไทย	2007-08-16	622	9	ถนนพหลโยธิน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเตรียมอุดมภาคภูมิ	422	2569	0	2569	1	10010005	1	2.39
อุดรธานี	เมืองอุดรธานี	หมากแข้ง	4-9818-65308-59-8	ทัศนัย ขาวสะอาด	ชาย	ไทย	2010-06-04	354/56	6	ถนนสาทร	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเตรียมอุดมภาคภูมิ	112	2569	0	2569	2	10010005	1	1.78
อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์	2-5864-40371-79-4	พรรษา มณีรัตน์	หญิง	ไทย	2015-10-02	632	6	ถนนพหลโยธิน	\N	\N	2	ยากจน	โรงเรียนเตรียมอุดมภาคภูมิ	104	2569	0	2569	2	10010005	2	1.54
อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์	1-2685-48405-64-8	ธนภัทร ศักดิ์สิทธิ์	ชาย	ไทย	2007-07-16	941/10	2	ถนนนวมินทร์	\N	\N	2	ยากจน	โรงเรียนเตรียมอุดมภาคภูมิ	422	2569	0	2569	3	10010005	1	2.37
อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์	2-4877-59361-14-5	วุฒิพงษ์ แสงสว่าง	ชาย	ไทย	2014-06-13	909/35	6	ถนนกลางเมือง	\N	\N	2	ยากจน	โรงเรียนเตรียมอุดมภาคภูมิ	104	2569	0	2569	2	10010005	1	2.3
อุดรธานี	เมืองอุดรธานี	หนองบัว	2-3134-75115-52-9	อัมพร สง่างาม	หญิง	ไทย	2006-09-11	806	9	ถนนราษฎร์บูรณะ	\N	\N	2	ยากจน	โรงเรียนเตรียมอุดมภาคภูมิ	423	2569	0	2569	2	10010005	2	1.03
อุดรธานี	เมืองอุดรธานี	หนองบัว	8-1854-20890-85-3	ทิพย์สุดา ชูศรี	หญิง	ไทย	2014-04-08	262	8	ถนนมิตรภาพ	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเตรียมอุดมภาคภูมิ	105	2569	0	2569	3	10010005	2	2.53
อุดรธานี	เมืองอุดรธานี	บ้านจั่น	2-2169-88728-35-6	กาญจนา สุขสันต์	หญิง	ไทย	2009-10-07	122	1	ถนนประดิษฐ์มนูธรรม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเตรียมอุดมภาคภูมิ	421	2569	0	2569	2	10010005	2	1.44
อุดรธานี	เมืองอุดรธานี	หมากแข้ง	8-7478-18950-37-6	รชานนท์ วิไลวรรณ	ชาย	ไทย	2018-06-25	167/71	2	ถนนอุดรดุษฎี	\N	\N	2	ยากจน	โรงเรียนเตรียมอุดมภาคภูมิ	101	2569	0	2569	3	10010005	1	1.09
อุดรธานี	เมืองอุดรธานี	หนองบัว	5-3658-93299-91-8	เกวลิน พงษ์ไพร	หญิง	ไทย	2007-12-28	137/82	8	ถนนมิตรภาพ	\N	\N	2	ยากจน	โรงเรียนเตรียมอุดมภาคภูมิ	423	2569	0	2569	1	10010005	2	1.57
อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์	5-9486-29419-88-3	สมหญิง อ่อนน้อม	หญิง	ไทย	2009-12-06	204	10	ถนนศรีนครินทร์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเตรียมอุดมภาคภูมิ	421	2569	0	2569	2	10010005	2	1.06
อุดรธานี	เมืองอุดรธานี	หมากแข้ง	2-2403-62693-54-6	บุษยา รุ่งเรือง	หญิง	ไทย	2007-11-26	539	7	ถนนมิตรภาพ	\N	\N	2	ยากจน	โรงเรียนเตรียมอุดมภาคภูมิ	422	2569	0	2569	1	10010005	2	1.75
อุดรธานี	เมืองอุดรธานี	บ้านขาว	1-1839-64526-61-1	สมชาย มณีรัตน์	ชาย	ไทย	2014-11-28	365	8	ถ.เอกชัย	\N	\N	2	ยากจน	โรงเรียนเตรียมอุดมภาคภูมิ	104	2569	0	2569	3	10010005	1	1.99
อุดรธานี	เมืองอุดรธานี	หมากแข้ง	5-4503-80771-14-1	วสันต์ จันทร์แก้ว	ชาย	ไทย	2015-03-23	927	4	ถนนสีลม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเตรียมอุดมภาคภูมิ	104	2569	0	2569	2	10010005	1	1.97
อุดรธานี	เมืองอุดรธานี	หนองบัว	1-9183-96836-77-8	ชูเกียรติ มงคล	ชาย	ไทย	2015-03-09	173	2	ถนนเพชรเกษม	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนเตรียมอุดมภาคภูมิ	104	2569	0	2569	2	10010005	1	2.71
อุดรธานี	เมืองอุดรธานี	หนองบัว	2-7864-81246-15-1	บุญยิ่ง สุขสบาย	ชาย	ไทย	2007-11-08	277	3	ถนนเพชรเกษม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนเตรียมอุดมภาคภูมิ	423	2569	0	2569	2	10010005	1	1.78
นครราชสีมา	เมืองนครราชสีมา	ในเมือง	8-2317-73544-17-3	ชาตรี ลือชา	ชาย	ไทย	2007-02-02	11/94	6	ถนนห้วยแก้ว	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอรรถวิทย์รังสรรค์	422	2569	0	2569	3	10010006	1	1.37
นครราชสีมา	เมืองนครราชสีมา	โคกสูง	1-6322-34542-85-5	พิมพ์ชนก อ่อนน้อม	หญิง	ไทย	2017-07-10	148/46	6	ถนนเยาวราช	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอรรถวิทย์รังสรรค์	102	2569	0	2569	1	10010006	2	2.04
นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง	2-3835-98753-48-4	สิรภพ คงพิทักษ์	ชาย	ไทย	2016-12-03	815/43	9	ถนนอ่อนนุช	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอรรถวิทย์รังสรรค์	103	2569	0	2569	1	10010006	1	2.16
นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง	8-7923-85974-11-5	นรวิชญ์ ประสิทธิ์ผล	ชาย	ไทย	2007-03-16	842	8	ถนนเยาวราช	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอรรถวิทย์รังสรรค์	422	2569	0	2569	2	10010006	1	1.25
นครราชสีมา	เมืองนครราชสีมา	มะเริง	1-8289-93913-81-1	นวลจันทร์ อินทร์ชัย	หญิง	ไทย	2018-09-12	827	9	ถ.บ้านโป่ง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอรรถวิทย์รังสรรค์	101	2569	0	2569	2	10010006	2	1.22
นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง	4-4971-55959-96-8	กาญจนา พรประเสริฐ	หญิง	ไทย	2013-12-14	525/59	1	ถนนงามวงศ์วาน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอรรถวิทย์รังสรรค์	105	2569	0	2569	3	10010006	2	1.52
นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง	7-2368-36818-60-4	ธนพัฒน์ งามดี	ชาย	ไทย	2007-02-16	493	6	ถนนสุขุมวิท	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอรรถวิทย์รังสรรค์	422	2569	0	2569	2	10010006	1	2.33
นครราชสีมา	เมืองนครราชสีมา	หนองจะบก	2-7473-40973-94-8	ณัฐวุฒิ แสงสว่าง	ชาย	ไทย	2014-09-07	570	5	ถนนมิตรภาพ	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอรรถวิทย์รังสรรค์	104	2569	0	2569	3	10010006	1	2.62
นครราชสีมา	เมืองนครราชสีมา	หนองจะบก	5-3058-66751-10-3	สมหญิง พงษ์ไพร	หญิง	ไทย	2011-06-22	452	3	ถนนสรงประภา	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอรรถวิทย์รังสรรค์	111	2569	0	2569	2	10010006	2	1.02
นครราชสีมา	เมืองนครราชสีมา	โคกสูง	5-1230-12130-85-8	กวินท์ บุญมี	ชาย	ไทย	2008-06-13	339/9	1	ถนนศรีนครินทร์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอรรถวิทย์รังสรรค์	422	2569	0	2569	3	10010006	1	1.23
นครราชสีมา	เมืองนครราชสีมา	ในเมือง	7-6766-64787-69-9	ไกรวุฒิ ยิ้มแย้ม	ชาย	ไทย	2006-09-28	582	7	ถนนกาญจนาภิเษก	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอรรถวิทย์รังสรรค์	423	2569	0	2569	3	10010006	1	2.4
นครราชสีมา	เมืองนครราชสีมา	ในเมือง	1-4640-31094-85-3	จิตรลดา สุจริต	หญิง	ไทย	2010-11-07	804	5	ถนนศรีนครินทร์	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	113	2569	0	2569	3	10010006	2	1.12
นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง	4-4773-14888-17-1	ชนะชัย คงมั่น	ชาย	ไทย	2009-10-27	297	3	ถนนช้างเผือก	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอรรถวิทย์รังสรรค์	113	2569	0	2569	2	10010006	1	1.23
นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง	6-9252-74273-92-3	ชินดนัย มณีรัตน์	ชาย	ไทย	2016-09-02	28/99	8	ถนนมิตรภาพ	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอรรถวิทย์รังสรรค์	103	2569	0	2569	1	10010006	1	1
นครราชสีมา	เมืองนครราชสีมา	หนองจะบก	4-2373-77035-65-1	ภูมิพัฒน์ สุขสันต์	ชาย	ไทย	2006-06-26	446	4	ถนนรามคำแหง	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	423	2569	0	2569	2	10010006	1	1.71
นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง	1-6743-39880-55-7	คุณากร ลือชา	ชาย	ไทย	2013-11-05	136	7	ถนนสุรวงศ์	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	105	2569	0	2569	1	10010006	1	2.53
นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง	3-8502-96097-41-8	เอกพงษ์ ชูศรี	ชาย	ไทย	2011-01-27	926/99	5	ถนนประดิษฐ์มนูธรรม	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอรรถวิทย์รังสรรค์	112	2569	0	2569	3	10010006	1	1.34
นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง	8-6938-61507-88-5	วิชญ์พล ชูศรี	ชาย	ไทย	2016-10-07	65	4	ถนนงามวงศ์วาน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอรรถวิทย์รังสรรค์	102	2569	0	2569	2	10010006	1	1.42
นครราชสีมา	เมืองนครราชสีมา	มะเริง	5-3650-90254-57-4	ชนะชัย พงษ์ไพร	ชาย	ไทย	2009-06-24	728	8	ถนนเพชรเกษม	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	421	2569	0	2569	3	10010006	1	2.26
นครราชสีมา	เมืองนครราชสีมา	ในเมือง	6-7743-98227-38-9	ประภา สมบูรณ์	หญิง	ไทย	2009-10-16	9/70	6	ถนนชัยพฤกษ์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอรรถวิทย์รังสรรค์	113	2569	0	2569	1	10010006	2	2.26
นครราชสีมา	เมืองนครราชสีมา	ในเมือง	6-2522-58220-55-7	ทัศนัย แสงสว่าง	ชาย	ไทย	2017-10-21	268	8	ถนนลาดพร้าว	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	101	2569	0	2569	1	10010006	1	1.48
นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง	1-9979-82179-80-9	รัฐนนท์ พรประเสริฐ	ชาย	ไทย	2010-01-16	287/30	6	ถนนเยาวราช	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอรรถวิทย์รังสรรค์	112	2569	0	2569	1	10010006	1	1.66
นครราชสีมา	เมืองนครราชสีมา	มะเริง	7-2137-39818-53-7	วรพล พรสวรรค์	ชาย	ไทย	2017-02-25	209	7	ถนนชัยพฤกษ์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอรรถวิทย์รังสรรค์	102	2569	0	2569	1	10010006	1	2.25
นครราชสีมา	เมืองนครราชสีมา	โคกสูง	2-6979-97229-72-8	แสงดาว พันธุ์ดี	หญิง	ไทย	2011-07-08	132	4	ถนนช้างเผือก	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	111	2569	0	2569	3	10010006	2	1.65
นครราชสีมา	เมืองนครราชสีมา	หนองจะบก	8-4042-71234-15-6	กัญญาณัฐ ลือชา	หญิง	ไทย	2016-04-17	593	5	ถนนบายพาส	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอรรถวิทย์รังสรรค์	103	2569	0	2569	1	10010006	2	1.99
นครราชสีมา	เมืองนครราชสีมา	ในเมือง	5-5762-75332-97-1	พรทิพย์ วิไลวรรณ	หญิง	ไทย	2015-02-16	433	8	ถนนนิมมานเหมินท์	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	104	2569	0	2569	1	10010006	2	2.27
นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง	1-1382-68653-18-2	ณัฐวรรธน์ เพ็งพา	ชาย	ไทย	2011-01-31	27	5	ถนนโชคชัย	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอรรถวิทย์รังสรรค์	111	2569	0	2569	1	10010006	1	1.91
นครราชสีมา	เมืองนครราชสีมา	มะเริง	1-2015-81090-78-2	ชูเกียรติ ดีสมัย	ชาย	ไทย	2016-01-01	292	9	ถนนนิมมานเหมินท์	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	103	2569	0	2569	2	10010006	1	2.01
นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง	3-3366-88452-62-1	ปาณิสรา ใจดี	หญิง	ไทย	2006-03-11	435	2	ถนนสุรวงศ์	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	423	2569	0	2569	3	10010006	2	2.79
นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง	6-3363-20151-81-7	วรพล ศรีสุข	ชาย	ไทย	2011-12-30	441	3	ถนนสาทร	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอรรถวิทย์รังสรรค์	112	2569	0	2569	3	10010006	1	2.39
นครราชสีมา	เมืองนครราชสีมา	โคกสูง	5-7508-39379-67-9	กาญจนา วิไลวรรณ	หญิง	ไทย	2012-04-10	484	9	ถนนมิตรภาพ	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอรรถวิทย์รังสรรค์	111	2569	0	2569	2	10010006	2	1.67
นครราชสีมา	เมืองนครราชสีมา	มะเริง	5-9498-24910-77-8	สุภัสสรา ปัญญาดี	หญิง	ไทย	2017-06-18	19	4	ถนนสาทร	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	102	2569	0	2569	2	10010006	2	2.25
นครราชสีมา	เมืองนครราชสีมา	โคกสูง	3-7314-78012-24-4	ปาณิสรา มีสุข	หญิง	ไทย	2016-12-26	427/85	10	ถนนสีลม	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	103	2569	0	2569	2	10010006	2	2.3
นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง	3-9824-30268-13-8	วรรณภา ลือชา	หญิง	ไทย	2007-02-06	315	10	ถนนห้วยแก้ว	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอรรถวิทย์รังสรรค์	423	2569	0	2569	3	10010006	2	2.26
นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง	2-3113-41475-96-2	ธัญชนก ทั่วถึง	หญิง	ไทย	2013-04-02	293	2	ถนนกาญจนาภิเษก	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอรรถวิทย์รังสรรค์	105	2569	0	2569	1	10010006	2	1.5
นครราชสีมา	เมืองนครราชสีมา	หนองจะบก	2-5112-38719-49-4	สมชาย พรประเสริฐ	ชาย	ไทย	2015-12-17	555	6	ถนนรัตนาธิเบศร์	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	103	2569	0	2569	1	10010006	1	2.32
นครราชสีมา	เมืองนครราชสีมา	ในเมือง	4-5115-19814-56-5	แสงดาว คงพิทักษ์	หญิง	ไทย	2008-05-09	770	3	ถนนนวมินทร์	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	421	2569	0	2569	1	10010006	2	1.12
นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง	3-8250-17956-63-1	มาลัย พันธุ์ดี	หญิง	ไทย	2016-06-13	457	2	ถนนกาญจนาภิเษก	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	103	2569	0	2569	3	10010006	2	2.5
นครราชสีมา	เมืองนครราชสีมา	โคกสูง	1-4842-27260-49-3	จิราพร พันธุ์ดี	หญิง	ไทย	2015-08-26	187/9	8	ถ.รัฐพัฒนา	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอรรถวิทย์รังสรรค์	103	2569	0	2569	3	10010006	2	1.19
นครราชสีมา	เมืองนครราชสีมา	ในเมือง	6-3664-47725-50-7	ทัศนัย สุดสวย	ชาย	ไทย	2006-03-23	14	2	ถนนราษฎร์บูรณะ	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	423	2569	0	2569	2	10010006	1	1.11
นครราชสีมา	เมืองนครราชสีมา	มะเริง	3-8287-14533-92-5	สุรชัย เพ็งพา	ชาย	ไทย	2018-07-31	202	6	ถนนราษฎร์บูรณะ	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	101	2569	0	2569	1	10010006	1	2.63
นครราชสีมา	เมืองนครราชสีมา	โคกสูง	7-3999-55222-93-7	ทัศนัย ธนาคาร	ชาย	ไทย	2009-09-24	712	6	ถนนมาลัยแมน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอรรถวิทย์รังสรรค์	421	2569	0	2569	1	10010006	1	1.85
นครราชสีมา	เมืองนครราชสีมา	โคกสูง	1-5659-52468-58-7	กัญญา บุญรอด	หญิง	ไทย	2011-10-07	6	7	ถนนราษฎร์บูรณะ	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอรรถวิทย์รังสรรค์	111	2569	0	2569	3	10010006	2	2.2
นครราชสีมา	เมืองนครราชสีมา	โคกสูง	2-9660-71616-19-2	พรทิพย์ เจริญชัย	หญิง	ไทย	2008-11-06	835	7	ถนนสีลม	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	422	2569	0	2569	2	10010006	2	2.09
นครราชสีมา	เมืองนครราชสีมา	ในเมือง	8-1852-67251-46-6	กุลธิดา ศรีสุข	หญิง	ไทย	2014-09-07	318	9	ถนนสาทร	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอรรถวิทย์รังสรรค์	104	2569	0	2569	3	10010006	2	2.25
นครราชสีมา	เมืองนครราชสีมา	มะเริง	4-1654-37488-38-8	กันตภณ มงคล	ชาย	ไทย	2009-04-30	602	7	ถนนงามวงศ์วาน	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนอรรถวิทย์รังสรรค์	421	2569	0	2569	3	10010006	1	1.16
นครราชสีมา	เมืองนครราชสีมา	โคกสูง	7-5216-47038-10-4	จันทร์เพ็ญ สุขสบาย	หญิง	ไทย	2016-09-22	778/97	6	ถ.เอกชัย	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	103	2569	0	2569	2	10010006	2	1.79
นครราชสีมา	เมืองนครราชสีมา	ในเมือง	3-7419-12905-15-6	จันทร์เพ็ญ อ่อนน้อม	หญิง	ไทย	2016-10-24	292/54	4	ถนนมิตรภาพ	\N	\N	2	ยากจน	โรงเรียนอรรถวิทย์รังสรรค์	102	2569	0	2569	2	10010006	2	2.05
นครราชสีมา	เมืองนครราชสีมา	หนองจะบก	5-5864-48022-19-4	ปัณฑิตา ปัญญาดี	หญิง	ไทย	2010-05-31	781	9	ถนนสรงประภา	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอรรถวิทย์รังสรรค์	113	2569	0	2569	2	10010006	2	1.8
นครราชสีมา	เมืองนครราชสีมา	หนองจะบก	8-4368-42155-78-1	วรพล พงษ์ไพร	ชาย	ไทย	2007-12-26	869/13	8	ถ.เอกชัย	\N	\N	1	ปัญหาครอบครัว	โรงเรียนอรรถวิทย์รังสรรค์	422	2569	0	2569	3	10010006	1	1.71
เชียงราย	เมืองเชียงราย	เวียง	4-2763-10349-50-6	ศิวกร มงคล	ชาย	ไทย	2015-07-02	29	7	ถนนรามคำแหง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	104	2569	0	2569	2	10010007	1	1.02
เชียงราย	เมืองเชียงราย	แม่กรณ์	7-1972-73073-40-4	บุญยิ่ง หอมหวาน	ชาย	ไทย	2010-03-16	570/14	1	ถนนศรีนครินทร์	\N	\N	2	ยากจน	โรงเรียนประชานุกูลประสิทธิ์	113	2569	0	2569	1	10010007	1	1.2
เชียงราย	เมืองเชียงราย	แม่กรณ์	3-2917-99949-58-9	ทักษิณ จันทร์แก้ว	ชาย	ไทย	2016-10-12	358	10	ถนนโชคชัย	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	102	2569	0	2569	3	10010007	1	1.95
เชียงราย	เมืองเชียงราย	แม่กรณ์	7-5211-61237-87-1	พรรษา นิ่มนวล	หญิง	ไทย	2015-09-21	644	2	ถนนพหลโยธิน	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	104	2569	0	2569	3	10010007	2	1.4
เชียงราย	เมืองเชียงราย	รอบเวียง	4-3716-33948-40-6	ปัณฑิตา อินทร์ชัย	หญิง	ไทย	2015-06-17	217	6	ถ.บ้านโป่ง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	104	2569	0	2569	1	10010007	2	2.23
เชียงราย	เมืองเชียงราย	รอบเวียง	2-9906-92553-78-8	ดวงใจ ทองดี	หญิง	ไทย	2013-09-18	156/79	7	ถนนกลางเมือง	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	106	2569	0	2569	2	10010007	2	1.57
เชียงราย	เมืองเชียงราย	แม่กรณ์	4-1162-77159-90-5	จิราพร กิตติคุณ	หญิง	ไทย	2007-04-22	837	4	ถ.บ้านโป่ง	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	423	2569	0	2569	1	10010007	2	1.85
เชียงราย	เมืองเชียงราย	รอบเวียง	7-9325-83841-79-7	กิตติภณ ประสิทธิ์ผล	ชาย	ไทย	2007-03-12	363	9	ถนนสุรวงศ์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	423	2569	0	2569	2	10010007	1	2.11
เชียงราย	เมืองเชียงราย	แม่กรณ์	8-6865-11077-10-4	สมหญิง มณีรัตน์	หญิง	ไทย	2011-03-09	537/93	5	ถนนรัตนาธิเบศร์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	111	2569	0	2569	2	10010007	2	2.53
เชียงราย	เมืองเชียงราย	บ้านดู่	1-1170-57238-98-9	นพรัตน์ บุญรอด	ชาย	ไทย	2017-04-01	216/25	5	ถนนนวมินทร์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	101	2569	0	2569	2	10010007	1	1.13
เชียงราย	เมืองเชียงราย	เวียง	2-8233-78244-48-4	ธัญชนก ชัยมงคล	หญิง	ไทย	2013-02-11	905	8	ถนนบายพาส	\N	\N	2	ยากจน	โรงเรียนประชานุกูลประสิทธิ์	106	2569	0	2569	1	10010007	2	2.65
เชียงราย	เมืองเชียงราย	รอบเวียง	2-7298-88169-55-4	ชูเกียรติ พรประเสริฐ	ชาย	ไทย	2006-07-22	661	3	ถนนเยาวราช	\N	\N	2	ยากจน	โรงเรียนประชานุกูลประสิทธิ์	423	2569	0	2569	3	10010007	1	1.86
เชียงราย	เมืองเชียงราย	นางแล	3-6374-85068-84-1	ประภา ปัญญาดี	หญิง	ไทย	2008-07-13	265	1	ถนนงามวงศ์วาน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	421	2569	0	2569	3	10010007	2	1.47
เชียงราย	เมืองเชียงราย	แม่กรณ์	5-4864-34432-45-5	สุทธิพงษ์ ธนาคาร	ชาย	ไทย	2013-07-27	912	8	ถนนนิมมานเหมินท์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	106	2569	0	2569	1	10010007	1	1.14
เชียงราย	เมืองเชียงราย	บ้านดู่	3-7601-86377-52-3	นวลจันทร์ สมบูรณ์	หญิง	ไทย	2013-08-28	599	4	ถนนโชคชัย	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	106	2569	0	2569	1	10010007	2	1.14
เชียงราย	เมืองเชียงราย	นางแล	3-2615-99573-15-1	ณัฐพล สกุลดี	ชาย	ไทย	2016-07-05	721	6	ถนนลาดพร้าว	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	103	2569	0	2569	1	10010007	1	2.43
เชียงราย	เมืองเชียงราย	นางแล	5-5702-21085-43-9	ธนาธิป สีดา	ชาย	ไทย	2007-12-27	147/97	4	ถนนสุขุมวิท	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	422	2569	0	2569	1	10010007	1	2.16
เชียงราย	เมืองเชียงราย	แม่กรณ์	6-8270-37389-86-4	เพ็ญพักตร์ วิไลวรรณ	หญิง	ไทย	2010-06-19	621	3	ถนนสุดสาคร	\N	\N	2	ยากจน	โรงเรียนประชานุกูลประสิทธิ์	113	2569	0	2569	1	10010007	2	2.58
เชียงราย	เมืองเชียงราย	นางแล	6-2793-44845-96-4	มณีรัตน์ ทองดี	หญิง	ไทย	2016-11-10	863	4	ถนนกลางเมือง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	103	2569	0	2569	3	10010007	2	2.37
เชียงราย	เมืองเชียงราย	รอบเวียง	4-8133-73689-89-9	สุนิสา คงพิทักษ์	หญิง	ไทย	2017-04-21	842	10	ถนนสาทร	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	102	2569	0	2569	2	10010007	2	1.85
เชียงราย	เมืองเชียงราย	บ้านดู่	8-4291-71358-46-9	วีรชัย อินทร์ชัย	ชาย	ไทย	2017-04-09	812	2	ถนนนวมินทร์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	101	2569	0	2569	2	10010007	1	1.33
เชียงราย	เมืองเชียงราย	เวียง	2-9891-47244-47-1	บุษยา กิตติคุณ	หญิง	ไทย	2010-08-17	583/22	6	ถนนห้วยแก้ว	\N	\N	2	ยากจน	โรงเรียนประชานุกูลประสิทธิ์	113	2569	0	2569	3	10010007	2	1.27
เชียงราย	เมืองเชียงราย	รอบเวียง	1-3936-30516-13-4	วาสนา รักษ์ไทย	หญิง	ไทย	2013-04-19	464	4	ถนนมิตรภาพ	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	106	2569	0	2569	2	10010007	2	2.77
เชียงราย	เมืองเชียงราย	บ้านดู่	2-7840-46416-97-8	ประพันธ์ ยิ้มแย้ม	ชาย	ไทย	2014-07-25	557	1	ถนนมาลัยแมน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	104	2569	0	2569	1	10010007	1	2.44
เชียงราย	เมืองเชียงราย	แม่กรณ์	6-2162-12770-26-2	ชินดนัย กิตติคุณ	ชาย	ไทย	2017-09-27	833	7	ถนนห้วยแก้ว	\N	\N	2	ยากจน	โรงเรียนประชานุกูลประสิทธิ์	102	2569	0	2569	2	10010007	1	1.64
เชียงราย	เมืองเชียงราย	รอบเวียง	1-7412-18790-55-3	สุทธิพงษ์ พรสวรรค์	ชาย	ไทย	2007-07-30	701/4	2	ถนนบรมราชชนนี	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	422	2569	0	2569	2	10010007	1	2.57
เชียงราย	เมืองเชียงราย	แม่กรณ์	5-8636-93861-99-1	จิตรลดา วิริยะ	หญิง	ไทย	2007-03-29	12	7	ถนนศรีนครินทร์	\N	\N	2	ยากจน	โรงเรียนประชานุกูลประสิทธิ์	423	2569	0	2569	1	10010007	2	1.04
เชียงราย	เมืองเชียงราย	บ้านดู่	5-9952-94538-85-1	ปัณฑิตา ใจดี	หญิง	ไทย	2011-05-21	615	4	ถนนสีลม	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	112	2569	0	2569	2	10010007	2	1.14
เชียงราย	เมืองเชียงราย	นางแล	1-7872-66776-16-6	อนุชา ขาวสะอาด	ชาย	ไทย	2007-10-15	505	6	ถนนสรงประภา	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	422	2569	0	2569	2	10010007	1	1.84
เชียงราย	เมืองเชียงราย	เวียง	6-9249-30815-27-2	สุทธิพงษ์ มงคล	ชาย	ไทย	2009-09-10	528	9	ถ.ประชาสามัคคี	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	113	2569	0	2569	1	10010007	1	1.17
เชียงราย	เมืองเชียงราย	บ้านดู่	7-7740-20796-37-8	ภัคพล รักษ์ไทย	ชาย	ไทย	2007-10-26	15/4	9	ถนนวิภาวดีรังสิต	\N	\N	2	ยากจน	โรงเรียนประชานุกูลประสิทธิ์	422	2569	0	2569	3	10010007	1	1.62
เชียงราย	เมืองเชียงราย	บ้านดู่	3-8461-93377-47-4	ปิยนุช วิไลวรรณ	หญิง	ไทย	2014-05-05	577/78	2	ถนนเพชรเกษม	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	104	2569	0	2569	3	10010007	2	1.08
เชียงราย	เมืองเชียงราย	บ้านดู่	3-1897-85771-95-6	มณีรัตน์ นามมนตรี	หญิง	ไทย	2013-08-28	818/97	8	ถนนช้างเผือก	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	106	2569	0	2569	3	10010007	2	1.04
เชียงราย	เมืองเชียงราย	เวียง	4-1352-29455-16-7	วรรณภา มีสุข	หญิง	ไทย	2015-12-29	789	3	ถนนพหลโยธิน	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	103	2569	0	2569	2	10010007	2	1.34
เชียงราย	เมืองเชียงราย	แม่กรณ์	8-9429-51522-67-6	ธนพัฒน์ พันธุ์ดี	ชาย	ไทย	2012-06-14	887/29	3	ถนนบายพาส	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	106	2569	0	2569	2	10010007	1	1.37
เชียงราย	เมืองเชียงราย	เวียง	3-1122-51883-15-3	กิตติภณ คงมั่น	ชาย	ไทย	2009-06-09	381	6	ถนนงามวงศ์วาน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	113	2569	0	2569	1	10010007	1	1.94
เชียงราย	เมืองเชียงราย	แม่กรณ์	5-3950-97229-62-5	สุทธิพงษ์ งามดี	ชาย	ไทย	2008-08-23	659	8	ถนนสุขุมวิท	\N	\N	2	ยากจน	โรงเรียนประชานุกูลประสิทธิ์	422	2569	0	2569	2	10010007	1	2.48
เชียงราย	เมืองเชียงราย	รอบเวียง	6-3239-73570-42-3	นรวิชญ์ พันธุ์ดี	ชาย	ไทย	2013-01-21	980	7	ถนนเพชรเกษม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	106	2569	0	2569	3	10010007	1	1.64
เชียงราย	เมืองเชียงราย	บ้านดู่	1-5110-52303-43-1	ประภา กิตติคุณ	หญิง	ไทย	2013-08-03	446/93	8	ถนนเจริญกรุง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	106	2569	0	2569	3	10010007	2	2.19
เชียงราย	เมืองเชียงราย	แม่กรณ์	7-7605-19673-94-2	ไกรวุฒิ รักษ์ไทย	ชาย	ไทย	2013-02-27	888	8	ถนนรัตนาธิเบศร์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	105	2569	0	2569	1	10010007	1	1.94
เชียงราย	เมืองเชียงราย	เวียง	1-3504-14232-34-2	อภิญญา นิ่มนวล	หญิง	ไทย	2010-09-14	383/60	8	ถนนห้วยแก้ว	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	113	2569	0	2569	1	10010007	2	1.75
เชียงราย	เมืองเชียงราย	รอบเวียง	5-5934-56577-13-8	รชานนท์ ดีสมัย	ชาย	ไทย	2013-09-26	445	5	ถ.รัฐพัฒนา	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	106	2569	0	2569	3	10010007	1	1.46
เชียงราย	เมืองเชียงราย	รอบเวียง	8-9046-57523-97-2	ณัฐวุฒิ ธนาคาร	ชาย	ไทย	2013-09-30	884/41	9	ถนนสุขุมวิท	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	106	2569	0	2569	2	10010007	1	1.96
เชียงราย	เมืองเชียงราย	เวียง	8-4497-64206-11-1	นันทพร เพ็งพา	หญิง	ไทย	2016-06-14	109/24	4	ถนนศรีนครินทร์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	102	2569	0	2569	1	10010007	2	2.78
เชียงราย	เมืองเชียงราย	รอบเวียง	5-2647-73895-85-4	ทัศนัย นิ่มนวล	ชาย	ไทย	2016-10-22	736	4	ถนนโชคชัย	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนประชานุกูลประสิทธิ์	102	2569	0	2569	2	10010007	1	2.63
เชียงราย	เมืองเชียงราย	แม่กรณ์	1-1417-41944-52-2	ธนภัทร ลือชา	ชาย	ไทย	2017-12-07	665/7	4	ถนนสาทร	\N	\N	2	ยากจน	โรงเรียนประชานุกูลประสิทธิ์	102	2569	0	2569	1	10010007	1	1.74
เชียงราย	เมืองเชียงราย	เวียง	3-1863-99086-67-4	ปัณณทัต ดำรงค์	ชาย	ไทย	2015-01-26	91/87	7	ถ.บ้านโป่ง	\N	\N	2	ยากจน	โรงเรียนประชานุกูลประสิทธิ์	104	2569	0	2569	2	10010007	1	2.26
เชียงราย	เมืองเชียงราย	แม่กรณ์	1-2581-59362-19-9	ปัณณทัต วิริยะ	ชาย	ไทย	2012-01-03	58/86	4	ถนนเจริญกรุง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	111	2569	0	2569	2	10010007	1	1.73
เชียงราย	เมืองเชียงราย	บ้านดู่	5-9078-56889-57-2	รัตนาภรณ์ ประสิทธิ์ผล	หญิง	ไทย	2015-11-22	341	7	ถนนเจริญกรุง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	104	2569	0	2569	1	10010007	2	2.32
เชียงราย	เมืองเชียงราย	แม่กรณ์	1-2116-83869-20-8	ธนาธิป คงพิทักษ์	ชาย	ไทย	2008-03-14	482	2	ถนนเจริญกรุง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนประชานุกูลประสิทธิ์	421	2569	0	2569	1	10010007	1	1.29
นครปฐม	เมืองนครปฐม	พระประโทน	6-8170-62002-65-2	พรรษา อ่อนน้อม	หญิง	ไทย	2017-04-12	159/58	8	ถนนวิภาวดีรังสิต	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	102	2569	0	2569	3	10010008	2	1.89
นครปฐม	เมืองนครปฐม	พระประโทน	8-6503-88644-77-3	สุดารัตน์ จันทร์แก้ว	หญิง	ไทย	2013-01-21	301	2	ถนนสาทร	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	106	2569	0	2569	1	10010008	2	1.51
นครปฐม	เมืองนครปฐม	พระประโทน	5-6191-68646-34-6	ธนพัฒน์ สุขสบาย	ชาย	ไทย	2016-07-04	171/5	8	ถนนเพชรเกษม	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	102	2569	0	2569	3	10010008	1	1.9
นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์	6-3344-75318-49-1	สมหญิง ดำรงค์	หญิง	ไทย	2016-07-21	996	6	ถนนอุดรดุษฎี	\N	\N	1	ปัญหาครอบครัว	โรงเรียนศึกษาวิสุทธิ์	102	2569	0	2569	2	10010008	2	1.48
นครปฐม	เมืองนครปฐม	บางแขม	3-7918-51824-22-3	อภิญญา ธนาคาร	หญิง	ไทย	2014-03-10	775	8	ถนนศรีนครินทร์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนศึกษาวิสุทธิ์	104	2569	0	2569	3	10010008	2	1.1
นครปฐม	เมืองนครปฐม	สามควายเผือก	1-6714-25890-18-4	ธัชพล สง่างาม	ชาย	ไทย	2014-07-19	847	2	ถนนศรีนครินทร์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนศึกษาวิสุทธิ์	104	2569	0	2569	1	10010008	1	2.62
นครปฐม	เมืองนครปฐม	พระประโทน	3-6687-21060-21-9	กวินท์ สีดา	ชาย	ไทย	2011-04-12	770	5	ถนนศรีนครินทร์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนศึกษาวิสุทธิ์	111	2569	0	2569	1	10010008	1	1.46
นครปฐม	เมืองนครปฐม	บางแขม	4-3806-91671-71-6	รัฐนนท์ ศักดิ์สิทธิ์	ชาย	ไทย	2013-06-03	503/38	1	ถ.ประชาสามัคคี	\N	\N	1	ปัญหาครอบครัว	โรงเรียนศึกษาวิสุทธิ์	106	2569	0	2569	1	10010008	1	2.7
นครปฐม	เมืองนครปฐม	พระประโทน	3-8203-95556-44-9	กันตภณ ปัญญาดี	ชาย	ไทย	2010-01-14	865	2	ถนนประดิษฐ์มนูธรรม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนศึกษาวิสุทธิ์	113	2569	0	2569	2	10010008	1	2.71
นครปฐม	เมืองนครปฐม	พระประโทน	7-5761-31270-75-5	รัฐนนท์ ลือชา	ชาย	ไทย	2007-07-21	671	7	ถนนประดิษฐ์มนูธรรม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนศึกษาวิสุทธิ์	423	2569	0	2569	2	10010008	1	2.07
นครปฐม	เมืองนครปฐม	สามควายเผือก	6-9845-62271-86-3	มานพ รักษ์ไทย	ชาย	ไทย	2011-03-09	462	5	ถนนราษฎร์บูรณะ	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนศึกษาวิสุทธิ์	111	2569	0	2569	3	10010008	1	2.67
นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์	3-9386-20751-23-2	ชัยชนะ แสงสว่าง	ชาย	ไทย	2015-09-27	969/5	5	ถนนสุขุมวิท	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	104	2569	0	2569	2	10010008	1	1.22
นครปฐม	เมืองนครปฐม	บางแขม	1-7121-27783-25-8	บุษยา อ่อนน้อม	หญิง	ไทย	2008-04-25	746/6	8	ถนนสุรวงศ์	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	422	2569	0	2569	3	10010008	2	1.54
นครปฐม	เมืองนครปฐม	บางแขม	6-9428-18570-16-8	วรรณภา ยิ้มแย้ม	หญิง	ไทย	2017-03-02	491/51	8	ถนนอุดรดุษฎี	\N	\N	1	ปัญหาครอบครัว	โรงเรียนศึกษาวิสุทธิ์	102	2569	0	2569	2	10010008	2	1.76
นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์	6-9578-80906-93-5	ชลธิชา สุจริต	หญิง	ไทย	2012-01-29	806	5	ถนนกาญจนาภิเษก	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	111	2569	0	2569	3	10010008	2	1.48
นครปฐม	เมืองนครปฐม	สามควายเผือก	4-9225-65426-81-5	ศิวกร ชัยมงคล	ชาย	ไทย	2017-10-07	324/54	6	ถนนศรีนครินทร์	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	101	2569	0	2569	2	10010008	1	2.53
นครปฐม	เมืองนครปฐม	พระประโทน	5-2504-71102-79-4	สุนิสา มีสุข	หญิง	ไทย	2014-04-22	932/11	3	ถนนบายพาส	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	104	2569	0	2569	3	10010008	2	1.31
นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์	6-9638-98542-53-7	นพรัตน์ รุ่งเรือง	ชาย	ไทย	2010-01-15	765	8	ถ.บ้านโป่ง	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	113	2569	0	2569	1	10010008	1	1.39
นครปฐม	เมืองนครปฐม	บางแขม	4-5959-33144-48-3	ศิวกร เกียรติสกุล	ชาย	ไทย	2008-01-21	211/24	9	ถนนเจริญกรุง	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	422	2569	0	2569	3	10010008	1	2.65
นครปฐม	เมืองนครปฐม	พระประโทน	7-3981-72403-32-6	พิมพ์ชนก มณีรัตน์	หญิง	ไทย	2012-05-18	547	7	ถนนรามคำแหง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนศึกษาวิสุทธิ์	106	2569	0	2569	3	10010008	2	2.43
นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์	8-5238-30310-62-2	ชนะชัย ใจดี	ชาย	ไทย	2007-09-21	356	5	ถ.รัฐพัฒนา	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนศึกษาวิสุทธิ์	422	2569	0	2569	1	10010008	1	1.99
นครปฐม	เมืองนครปฐม	บางแขม	4-4950-34126-14-1	วรากร สง่างาม	ชาย	ไทย	2007-01-20	431/83	10	ถนนสีลม	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	423	2569	0	2569	2	10010008	1	1.67
นครปฐม	เมืองนครปฐม	สามควายเผือก	1-3765-35451-39-6	นันทพร นิ่มนวล	หญิง	ไทย	2007-11-15	164/67	5	ถนนกลางเมือง	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	423	2569	0	2569	3	10010008	2	2.77
นครปฐม	เมืองนครปฐม	พระประโทน	5-2159-61524-88-9	นลินทิพย์ พรสวรรค์	หญิง	ไทย	2009-08-08	871/42	6	ถนนอุดรดุษฎี	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	113	2569	0	2569	1	10010008	2	1.11
นครปฐม	เมืองนครปฐม	พระประโทน	2-1110-48049-33-5	ไกรวุฒิ สกุลดี	ชาย	ไทย	2006-02-22	812/72	5	ถนนสุดสาคร	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	423	2569	0	2569	2	10010008	1	2.16
นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์	6-4149-76556-44-5	ชินดนัย พงษ์ไพร	ชาย	ไทย	2013-05-03	23	5	ถ.ประชาสามัคคี	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	106	2569	0	2569	2	10010008	1	2.67
นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์	8-8488-19640-48-1	สุรชัย นิ่มนวล	ชาย	ไทย	2010-06-07	25	5	ถนนบายพาส	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนศึกษาวิสุทธิ์	112	2569	0	2569	2	10010008	1	2.57
นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์	2-9338-78812-53-8	คุณากร กิตติคุณ	ชาย	ไทย	2009-07-08	766/35	6	ถนนราษฎร์บูรณะ	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	421	2569	0	2569	1	10010008	1	1.42
นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์	1-9605-32132-97-6	วิมลรัตน์ เพ็งพา	หญิง	ไทย	2007-02-05	259	6	ถนนสรงประภา	\N	\N	1	ปัญหาครอบครัว	โรงเรียนศึกษาวิสุทธิ์	422	2569	0	2569	1	10010008	2	2.32
นครปฐม	เมืองนครปฐม	พระประโทน	7-5031-34675-41-9	ชัยชนะ บุญมี	ชาย	ไทย	2017-12-11	110	8	ถนนนวมินทร์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนศึกษาวิสุทธิ์	102	2569	0	2569	2	10010008	1	2.6
นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์	7-1849-53211-39-4	กวินท์ รุ่งเรือง	ชาย	ไทย	2008-02-16	479/16	10	ถนนสุรวงศ์	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	421	2569	0	2569	2	10010008	1	1.84
นครปฐม	เมืองนครปฐม	สามควายเผือก	2-5254-93945-37-7	ไกรวุฒิ สง่างาม	ชาย	ไทย	2007-09-17	257	10	ถนนบายพาส	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนศึกษาวิสุทธิ์	423	2569	0	2569	3	10010008	1	1.61
นครปฐม	เมืองนครปฐม	บางแขม	3-7480-72154-25-3	สมชาย ขาวสะอาด	ชาย	ไทย	2006-12-15	988/36	1	ถนนวิภาวดีรังสิต	\N	\N	1	ปัญหาครอบครัว	โรงเรียนศึกษาวิสุทธิ์	423	2569	0	2569	2	10010008	1	2.06
นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์	5-7886-16279-11-8	วรรณภา วิริยะ	หญิง	ไทย	2007-09-11	596	5	ถนนรัตนาธิเบศร์	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	422	2569	0	2569	3	10010008	2	1.44
นครปฐม	เมืองนครปฐม	พระประโทน	3-6129-54538-83-4	อัมพร พรประเสริฐ	หญิง	ไทย	2013-01-26	253/65	7	ถนนห้วยแก้ว	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	106	2569	0	2569	2	10010008	2	2.51
นครปฐม	เมืองนครปฐม	บางแขม	8-7912-45972-59-6	บุษยา แสงสว่าง	หญิง	ไทย	2017-05-09	207/94	8	ถนนกลางเมือง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนศึกษาวิสุทธิ์	101	2569	0	2569	3	10010008	2	2.2
นครปฐม	เมืองนครปฐม	สามควายเผือก	4-4796-49391-94-2	ดรุณี รุ่งเรือง	หญิง	ไทย	2016-12-03	916	9	ถนนสุรวงศ์	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	103	2569	0	2569	2	10010008	2	1.23
นครปฐม	เมืองนครปฐม	สามควายเผือก	7-9399-59077-71-6	วสันต์ ลือชา	ชาย	ไทย	2017-09-04	234	2	ถนนบายพาส	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	101	2569	0	2569	3	10010008	1	1.34
นครปฐม	เมืองนครปฐม	บางแขม	7-7500-21557-58-4	ชินดนัย นิ่มนวล	ชาย	ไทย	2014-01-24	638	9	ถนนเพชรเกษม	\N	\N	1	ปัญหาครอบครัว	โรงเรียนศึกษาวิสุทธิ์	105	2569	0	2569	1	10010008	1	1.23
นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์	8-5995-77932-25-6	นันทพร สง่างาม	หญิง	ไทย	2015-12-13	803/40	7	ถนนรัตนาธิเบศร์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนศึกษาวิสุทธิ์	103	2569	0	2569	3	10010008	2	2.44
นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์	5-3816-14602-60-1	พรทิพย์ คงพิทักษ์	หญิง	ไทย	2009-04-21	626	4	ถนนสุดสาคร	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนศึกษาวิสุทธิ์	113	2569	0	2569	1	10010008	2	1.6
นครปฐม	เมืองนครปฐม	พระประโทน	4-6548-10860-61-2	สมศักดิ์ กิตติคุณ	ชาย	ไทย	2010-08-10	907	3	ถนนสาทร	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนศึกษาวิสุทธิ์	113	2569	0	2569	3	10010008	1	2.38
นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์	7-6562-69083-85-7	กิตติภณ บริบูรณ์	ชาย	ไทย	2012-03-15	724	2	ถนนพหลโยธิน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนศึกษาวิสุทธิ์	106	2569	0	2569	1	10010008	1	1.54
นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์	3-2357-51835-88-6	ณัฐพล บุญมี	ชาย	ไทย	2015-09-23	777	4	ถนนงามวงศ์วาน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนศึกษาวิสุทธิ์	103	2569	0	2569	1	10010008	1	1.88
นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์	5-1105-49416-41-8	สมหญิง รุ่งเรือง	หญิง	ไทย	2010-09-14	562/37	2	ถนนรามคำแหง	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนศึกษาวิสุทธิ์	112	2569	0	2569	3	10010008	2	1.01
นครปฐม	เมืองนครปฐม	สามควายเผือก	7-4803-44650-15-6	ปิยนุช บริบูรณ์	หญิง	ไทย	2006-08-18	827	2	ถนนอ่อนนุช	\N	\N	1	ปัญหาครอบครัว	โรงเรียนศึกษาวิสุทธิ์	423	2569	0	2569	1	10010008	2	2.58
นครปฐม	เมืองนครปฐม	พระประโทน	2-9318-32342-39-4	สมชาย บริบูรณ์	ชาย	ไทย	2015-08-27	839/63	2	ถนนมาลัยแมน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนศึกษาวิสุทธิ์	103	2569	0	2569	1	10010008	1	1.34
นครปฐม	เมืองนครปฐม	สามควายเผือก	2-5705-48633-26-4	วันวิสา สุดสวย	หญิง	ไทย	2009-03-09	225/20	2	ถนนห้วยแก้ว	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	113	2569	0	2569	2	10010008	2	1.55
นครปฐม	เมืองนครปฐม	บางแขม	8-6023-61959-77-8	อภิวัฒน์ คงมั่น	ชาย	ไทย	2008-10-11	994	8	ถนนบรมราชชนนี	\N	\N	2	ยากจน	โรงเรียนศึกษาวิสุทธิ์	422	2569	0	2569	3	10010008	1	2.59
นครปฐม	เมืองนครปฐม	สามควายเผือก	6-8401-88571-68-9	มณีรัตน์ ทั่วถึง	หญิง	ไทย	2016-08-23	751	9	ถ.บ้านโป่ง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนศึกษาวิสุทธิ์	102	2569	0	2569	3	10010008	2	1.38
ตรัง	เมืองตรัง	นาตาล่วง	4-4532-67064-86-4	ภัทรวดี บริบูรณ์	หญิง	ไทย	2010-03-05	585/96	10	ถนนช้างเผือก	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนดรุณศึกษาธิการ	113	2569	0	2569	2	10010009	2	2.17
ตรัง	เมืองตรัง	บ้านควน	5-9853-22610-25-5	ภูมิพัฒน์ บุญมี	ชาย	ไทย	2017-07-30	955	2	ถนนสุรวงศ์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	101	2569	0	2569	3	10010009	1	1.22
ตรัง	เมืองตรัง	นาตาล่วง	5-3222-38205-51-3	ปัณณทัต ใจดี	ชาย	ไทย	2015-06-21	763/26	8	ถนนรามคำแหง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	104	2569	0	2569	1	10010009	1	2.23
ตรัง	เมืองตรัง	บ้านควน	2-1105-42765-93-1	ภัทรวดี บริบูรณ์	หญิง	ไทย	2011-07-10	960	2	ถนนมาลัยแมน	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนดรุณศึกษาธิการ	111	2569	0	2569	2	10010009	2	2.6
ตรัง	เมืองตรัง	นาตาล่วง	2-2811-79244-81-1	เอกพงษ์ นามมนตรี	ชาย	ไทย	2017-08-22	448	5	ถนนสุรวงศ์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนดรุณศึกษาธิการ	101	2569	0	2569	3	10010009	1	1.72
ตรัง	เมืองตรัง	นาพละ	2-3778-10010-58-3	ชนะชัย ขาวสะอาด	ชาย	ไทย	2008-06-08	833	5	ถนนงามวงศ์วาน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	422	2569	0	2569	3	10010009	1	2.1
ตรัง	เมืองตรัง	นาตาล่วง	2-6569-12399-87-6	ประภา มณีรัตน์	หญิง	ไทย	2017-11-15	966	6	ถนนบายพาส	\N	\N	2	ยากจน	โรงเรียนดรุณศึกษาธิการ	102	2569	0	2569	3	10010009	2	2.32
ตรัง	เมืองตรัง	นาพละ	3-4640-22293-43-4	วรากร อ่อนน้อม	ชาย	ไทย	2014-09-16	620/95	9	ถนนชัยพฤกษ์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	104	2569	0	2569	1	10010009	1	1.61
ตรัง	เมืองตรัง	นาพละ	8-3739-66253-31-5	ประพันธ์ วังขวา	ชาย	ไทย	2009-02-15	858	10	ถนนสีลม	\N	\N	2	ยากจน	โรงเรียนดรุณศึกษาธิการ	421	2569	0	2569	3	10010009	1	2.6
ตรัง	เมืองตรัง	นาตาล่วง	1-9915-72310-99-3	รชานนท์ วิไลวรรณ	ชาย	ไทย	2016-03-30	692/2	4	ถนนสุดสาคร	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนดรุณศึกษาธิการ	103	2569	0	2569	2	10010009	1	2.67
ตรัง	เมืองตรัง	บ้านควน	7-5409-92414-95-7	ธนภัทร สุดสวย	ชาย	ไทย	2016-11-11	686	7	ถนนกลางเมือง	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนดรุณศึกษาธิการ	103	2569	0	2569	1	10010009	1	1.52
ตรัง	เมืองตรัง	บ้านควน	2-3159-36630-91-7	นันทพร ลือชา	หญิง	ไทย	2007-05-27	333	7	ถนนวิภาวดีรังสิต	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	423	2569	0	2569	2	10010009	2	1.28
ตรัง	เมืองตรัง	ทับเที่ยง	6-1018-38670-81-3	สิรภพ ชูศรี	ชาย	ไทย	2014-01-05	261	4	ถนนรัตนาธิเบศร์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	104	2569	0	2569	3	10010009	1	2.33
ตรัง	เมืองตรัง	บ้านควน	5-7053-60291-64-4	ปรเมศวร์ สุจริต	ชาย	ไทย	2009-08-18	24	1	ถนนบายพาส	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	113	2569	0	2569	2	10010009	1	1.7
ตรัง	เมืองตรัง	บ้านควน	7-5938-50802-62-6	กัญญา แสงสว่าง	หญิง	ไทย	2006-10-21	69/13	8	ถนนชัยพฤกษ์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	423	2569	0	2569	3	10010009	2	2.66
ตรัง	เมืองตรัง	นาพละ	3-9787-44973-47-6	ณัฐพล สุขสบาย	ชาย	ไทย	2016-06-22	336	1	ถ.เอกชัย	\N	\N	2	ยากจน	โรงเรียนดรุณศึกษาธิการ	103	2569	0	2569	2	10010009	1	2.04
ตรัง	เมืองตรัง	ทับเที่ยง	5-5390-13948-16-1	ทักษิณ สุจริต	ชาย	ไทย	2009-05-26	67/43	7	ถนนเจริญกรุง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	113	2569	0	2569	3	10010009	1	2.28
ตรัง	เมืองตรัง	นาตาล่วง	7-5978-49514-27-3	กาญจนา คงพิทักษ์	หญิง	ไทย	2017-08-18	856	7	ถนนมาลัยแมน	\N	\N	2	ยากจน	โรงเรียนดรุณศึกษาธิการ	101	2569	0	2569	3	10010009	2	2.63
ตรัง	เมืองตรัง	นาตาล่วง	4-5807-75538-50-7	อนุชา วิริยะ	ชาย	ไทย	2012-07-31	991	6	ถ.เอกชัย	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนดรุณศึกษาธิการ	111	2569	0	2569	1	10010009	1	2.46
ตรัง	เมืองตรัง	บ้านควน	7-1546-57206-98-8	บุญยิ่ง ดีสมัย	ชาย	ไทย	2006-03-28	608/9	6	ถ.รัฐพัฒนา	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	423	2569	0	2569	2	10010009	1	2.39
ตรัง	เมืองตรัง	บ้านควน	2-3942-44225-57-8	ภูมิพัฒน์ ทองดี	ชาย	ไทย	2017-01-12	241	10	ถนนนวมินทร์	\N	\N	2	ยากจน	โรงเรียนดรุณศึกษาธิการ	102	2569	0	2569	2	10010009	1	1.83
ตรัง	เมืองตรัง	นาพละ	8-1844-67910-76-7	สมศักดิ์ แสงสว่าง	ชาย	ไทย	2015-01-05	732/68	4	ถนนชัยพฤกษ์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	103	2569	0	2569	3	10010009	1	2.54
ตรัง	เมืองตรัง	ทับเที่ยง	6-8411-40069-30-3	ประพันธ์ เพียรดี	ชาย	ไทย	2018-09-05	965/32	3	ถนนสุดสาคร	\N	\N	2	ยากจน	โรงเรียนดรุณศึกษาธิการ	101	2569	0	2569	1	10010009	1	2.3
ตรัง	เมืองตรัง	นาตาล่วง	4-3737-17911-88-2	เจษฎา สุวรรณภูมิ	ชาย	ไทย	2013-05-28	140/27	5	ถนนประดิษฐ์มนูธรรม	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนดรุณศึกษาธิการ	105	2569	0	2569	1	10010009	1	2.73
ตรัง	เมืองตรัง	บ้านควน	8-3353-67466-75-6	วรพล รุ่งเรือง	ชาย	ไทย	2017-12-21	492/18	4	ถนนวิภาวดีรังสิต	\N	\N	2	ยากจน	โรงเรียนดรุณศึกษาธิการ	102	2569	0	2569	3	10010009	1	1.73
ตรัง	เมืองตรัง	บ้านควน	4-1795-91627-29-2	กาญจนา สุดสวย	หญิง	ไทย	2010-03-23	249	1	ถนนรามคำแหง	\N	\N	2	ยากจน	โรงเรียนดรุณศึกษาธิการ	112	2569	0	2569	3	10010009	2	1.85
ตรัง	เมืองตรัง	นาพละ	5-8828-45141-40-5	ดิศรณ์ กิตติคุณ	ชาย	ไทย	2013-01-12	88	2	ถนนกลางเมือง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	105	2569	0	2569	3	10010009	1	1.79
ตรัง	เมืองตรัง	ทับเที่ยง	3-2585-77059-61-5	นวลจันทร์ สกุลดี	หญิง	ไทย	2008-01-16	947/72	3	ถนนบรมราชชนนี	\N	\N	2	ยากจน	โรงเรียนดรุณศึกษาธิการ	422	2569	0	2569	3	10010009	2	2.63
ตรัง	เมืองตรัง	นาตาล่วง	2-1444-81913-54-5	สุภัสสรา เกียรติสกุล	หญิง	ไทย	2017-05-01	942/29	1	ถนนอ่อนนุช	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	102	2569	0	2569	1	10010009	2	1.92
ตรัง	เมืองตรัง	บ้านควน	3-1181-52535-62-1	พรทิพย์ เกียรติสกุล	หญิง	ไทย	2012-12-03	4	5	ถนนสรงประภา	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	106	2569	0	2569	1	10010009	2	2.08
ตรัง	เมืองตรัง	นาตาล่วง	7-8599-16202-67-2	อภิวัฒน์ มงคล	ชาย	ไทย	2013-08-04	44/3	2	ถนนบรมราชชนนี	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	106	2569	0	2569	3	10010009	1	2.11
ตรัง	เมืองตรัง	นาพละ	3-5092-56505-49-4	วสันต์ พรสวรรค์	ชาย	ไทย	2017-08-18	204	5	ถนนห้วยแก้ว	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	101	2569	0	2569	1	10010009	1	1.38
ตรัง	เมืองตรัง	ทับเที่ยง	5-2635-32569-20-7	ดวงใจ มงคล	หญิง	ไทย	2013-02-12	226	3	ถนนเยาวราช	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	106	2569	0	2569	2	10010009	2	1.7
ตรัง	เมืองตรัง	นาตาล่วง	5-4568-84992-64-1	ธัญชนก เพ็งพา	หญิง	ไทย	2015-09-28	612	7	ถนนรัตนาธิเบศร์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	104	2569	0	2569	2	10010009	2	1.5
ตรัง	เมืองตรัง	ทับเที่ยง	8-2142-92263-17-9	มานพ วงษ์สุวรรณ	ชาย	ไทย	2017-12-25	848/97	6	ถนนอ่อนนุช	\N	\N	2	ยากจน	โรงเรียนดรุณศึกษาธิการ	101	2569	0	2569	3	10010009	1	2.13
ตรัง	เมืองตรัง	บ้านควน	6-4295-91968-29-1	ดรุณี วังขวา	หญิง	ไทย	2008-06-29	732	9	ถนนสีลม	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนดรุณศึกษาธิการ	422	2569	0	2569	3	10010009	2	2.19
ตรัง	เมืองตรัง	บ้านควน	1-2311-51843-31-9	นลินทิพย์ นามมนตรี	หญิง	ไทย	2016-10-28	985/94	7	ถนนเยาวราช	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนดรุณศึกษาธิการ	103	2569	0	2569	3	10010009	2	2.09
ตรัง	เมืองตรัง	นาตาล่วง	3-5392-62805-89-7	สุภัสสรา ยิ้มแย้ม	หญิง	ไทย	2013-04-02	705/22	9	ถนนอุดรดุษฎี	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนดรุณศึกษาธิการ	106	2569	0	2569	1	10010009	2	2.05
ตรัง	เมืองตรัง	นาตาล่วง	4-1887-14447-50-5	วาสนา สุขสบาย	หญิง	ไทย	2016-07-08	457	3	ถนนวิภาวดีรังสิต	\N	\N	2	ยากจน	โรงเรียนดรุณศึกษาธิการ	102	2569	0	2569	3	10010009	2	2.03
ตรัง	เมืองตรัง	นาพละ	4-3532-54208-56-2	สุดารัตน์ รักษ์ไทย	หญิง	ไทย	2007-07-30	842/51	10	ถนนงามวงศ์วาน	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนดรุณศึกษาธิการ	423	2569	0	2569	2	10010009	2	1.16
ตรัง	เมืองตรัง	นาพละ	1-7456-66106-12-3	กวินท์ เพ็งพา	ชาย	ไทย	2009-04-14	133	4	ถนนงามวงศ์วาน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	421	2569	0	2569	2	10010009	1	1.43
ตรัง	เมืองตรัง	บ้านควน	1-4422-50907-22-8	วรรณภา ศรีสุข	หญิง	ไทย	2006-07-04	428/87	10	ถ.บ้านโป่ง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	423	2569	0	2569	1	10010009	2	1.53
ตรัง	เมืองตรัง	นาพละ	1-5288-71039-13-5	วุฒิพงษ์ ลือชา	ชาย	ไทย	2011-10-01	844	1	ถนนนวมินทร์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนดรุณศึกษาธิการ	112	2569	0	2569	2	10010009	1	1.68
ตรัง	เมืองตรัง	นาตาล่วง	5-5083-11796-99-2	สุมาลี ขาวสะอาด	หญิง	ไทย	2011-06-28	815/50	10	ถนนนิมมานเหมินท์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	112	2569	0	2569	1	10010009	2	1.65
ตรัง	เมืองตรัง	นาพละ	1-6680-15275-89-9	นลินทิพย์ เพียรดี	หญิง	ไทย	2012-09-14	839/19	2	ถนนมาลัยแมน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	106	2569	0	2569	1	10010009	2	1.91
ตรัง	เมืองตรัง	บ้านควน	5-1269-95010-73-5	เพ็ญพักตร์ อินทร์ชัย	หญิง	ไทย	2015-07-05	588/32	5	ถนนบรมราชชนนี	\N	\N	1	ปัญหาครอบครัว	โรงเรียนดรุณศึกษาธิการ	103	2569	0	2569	2	10010009	2	2.27
ตรัง	เมืองตรัง	นาพละ	5-1421-28378-82-2	ปัณณทัต มงคล	ชาย	ไทย	2015-11-25	971/18	3	ถ.เอกชัย	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนดรุณศึกษาธิการ	103	2569	0	2569	2	10010009	1	1.9
ตรัง	เมืองตรัง	ทับเที่ยง	1-7364-43815-37-9	นรวิชญ์ ชูศรี	ชาย	ไทย	2015-05-07	381	2	ถนนสรงประภา	\N	\N	2	ยากจน	โรงเรียนดรุณศึกษาธิการ	103	2569	0	2569	3	10010009	1	2.44
ตรัง	เมืองตรัง	ทับเที่ยง	4-1137-90461-67-7	จิราพร สุดสวย	หญิง	ไทย	2014-04-26	599/85	5	ถนนบายพาส	\N	\N	2	ยากจน	โรงเรียนดรุณศึกษาธิการ	104	2569	0	2569	1	10010009	2	1.92
ตรัง	เมืองตรัง	ทับเที่ยง	6-4865-71326-68-6	ณัฐนิชา กิตติคุณ	หญิง	ไทย	2010-08-27	246/77	5	ถนนลาดพร้าว	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนดรุณศึกษาธิการ	112	2569	0	2569	3	10010009	2	2.48
อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ	4-4229-52915-12-7	นวลจันทร์ อ่อนน้อม	หญิง	ไทย	2014-07-17	590	5	ถนนนิมมานเหมินท์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนมัธยมวิทยาคุณ	104	2569	0	2569	1	10010010	2	1.48
อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ	8-2465-97022-32-8	วรพล พรประเสริฐ	ชาย	ไทย	2008-01-21	999	7	ถนนบายพาส	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	421	2569	0	2569	2	10010010	1	2.62
อุบลราชธานี	เมืองอุบลราชธานี	ปทุม	7-9440-88322-31-7	กัญญา เกียรติสกุล	หญิง	ไทย	2008-02-21	767	6	ถนนห้วยแก้ว	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนมัธยมวิทยาคุณ	422	2569	0	2569	1	10010010	2	2.24
อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง	7-1917-61828-38-8	สุรชัย สง่างาม	ชาย	ไทย	2017-04-08	13	6	ถนนช้างเผือก	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนมัธยมวิทยาคุณ	101	2569	0	2569	2	10010010	1	2.29
อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน	5-3882-38919-99-9	สุนิสา วังขวา	หญิง	ไทย	2012-04-16	429/40	6	ถนนสุขุมวิท	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	106	2569	0	2569	3	10010010	2	2.13
อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่	6-9432-18426-44-1	สุภัสสรา อินทร์ชัย	หญิง	ไทย	2008-10-30	87	2	ถนนรามคำแหง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนมัธยมวิทยาคุณ	422	2569	0	2569	3	10010010	2	1.28
อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน	2-7875-49983-50-9	สมชาย ทองดี	ชาย	ไทย	2007-11-06	705	1	ถนนเจริญกรุง	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนมัธยมวิทยาคุณ	422	2569	0	2569	1	10010010	1	1.31
อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ	8-3346-62276-34-5	วสันต์ สีดา	ชาย	ไทย	2012-12-18	726/41	7	ถนนกลางเมือง	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	111	2569	0	2569	3	10010010	1	1.64
อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ	6-9756-43200-55-8	ศิวกร กิตติคุณ	ชาย	ไทย	2012-07-24	137/48	1	ถนนรามคำแหง	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนมัธยมวิทยาคุณ	111	2569	0	2569	3	10010010	1	2.29
อุบลราชธานี	เมืองอุบลราชธานี	ปทุม	7-8794-70069-73-7	วีรชัย มณีรัตน์	ชาย	ไทย	2017-05-24	759/23	1	ถนนสรงประภา	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนมัธยมวิทยาคุณ	101	2569	0	2569	3	10010010	1	1.54
อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน	8-5868-40438-23-4	จิราพร พงษ์ไพร	หญิง	ไทย	2011-04-03	872/49	8	ถนนบรมราชชนนี	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	112	2569	0	2569	1	10010010	2	2.5
อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน	4-7517-31874-83-2	รัตนาภรณ์ พรสวรรค์	หญิง	ไทย	2012-07-26	550	10	ถนนอ่อนนุช	\N	\N	1	ปัญหาครอบครัว	โรงเรียนมัธยมวิทยาคุณ	106	2569	0	2569	3	10010010	2	1.24
อุบลราชธานี	เมืองอุบลราชธานี	ปทุม	6-2618-38397-19-6	เกวลิน คงพิทักษ์	หญิง	ไทย	2015-10-03	533	3	ถนนสุขุมวิท	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนมัธยมวิทยาคุณ	104	2569	0	2569	2	10010010	2	1.24
อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน	6-5906-93430-91-1	นรวิชญ์ มงคล	ชาย	ไทย	2010-08-09	455	6	ถนนสุรวงศ์	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	113	2569	0	2569	3	10010010	1	2.2
อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ	7-3966-94775-79-6	กันตภณ วงษ์สุวรรณ	ชาย	ไทย	2016-07-08	51/52	8	ถนนชัยพฤกษ์	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	102	2569	0	2569	3	10010010	1	1.54
อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน	6-1264-39319-70-6	ธัชพล งามดี	ชาย	ไทย	2014-04-17	13/95	7	ถนนพหลโยธิน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนมัธยมวิทยาคุณ	105	2569	0	2569	2	10010010	1	2.28
อุบลราชธานี	เมืองอุบลราชธานี	ปทุม	2-3172-40430-71-3	ศิริพร ทั่วถึง	หญิง	ไทย	2017-10-12	570	4	ถนนกลางเมือง	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนมัธยมวิทยาคุณ	101	2569	0	2569	2	10010010	2	2.54
อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ	4-2006-91249-50-5	ปิยนุช สุวรรณภูมิ	หญิง	ไทย	2011-09-17	483/89	8	ถนนเยาวราช	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนมัธยมวิทยาคุณ	111	2569	0	2569	3	10010010	2	1.74
อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน	7-2949-54068-23-7	ภัคพล พรประเสริฐ	ชาย	ไทย	2012-05-14	15/2	5	ถนนวิภาวดีรังสิต	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนมัธยมวิทยาคุณ	111	2569	0	2569	1	10010010	1	1.5
อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง	8-1547-68527-90-7	วันวิสา บุญรอด	หญิง	ไทย	2014-12-18	26/92	5	ถนนกลางเมือง	\N	\N	1	ปัญหาครอบครัว	โรงเรียนมัธยมวิทยาคุณ	104	2569	0	2569	1	10010010	2	1.09
อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ	3-8862-46208-94-3	กิตติภณ อ่อนน้อม	ชาย	ไทย	2007-04-15	759/19	9	ถนนรามคำแหง	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	423	2569	0	2569	1	10010010	1	1.16
อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่	1-9850-74423-55-4	ณัฐพล คงพิทักษ์	ชาย	ไทย	2013-09-04	465	2	ถนนศรีนครินทร์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนมัธยมวิทยาคุณ	105	2569	0	2569	3	10010010	1	1.22
อุบลราชธานี	เมืองอุบลราชธานี	ปทุม	7-2206-78434-82-5	ณัฐนิชา มณีรัตน์	หญิง	ไทย	2016-03-09	134	7	ถนนชัยพฤกษ์	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	103	2569	0	2569	2	10010010	2	1.62
อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ	4-8036-55577-50-3	วาสนา บุญมี	หญิง	ไทย	2007-02-01	159/25	9	ถนนวิภาวดีรังสิต	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนมัธยมวิทยาคุณ	422	2569	0	2569	3	10010010	2	1.26
อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง	2-7414-18225-87-6	วิชญ์พล สุขสบาย	ชาย	ไทย	2015-12-28	732/59	3	ถนนอ่อนนุช	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	103	2569	0	2569	3	10010010	1	1.84
อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง	1-8278-19176-19-4	ทัศนัย เพียรดี	ชาย	ไทย	2013-11-08	515	6	ถนนงามวงศ์วาน	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนมัธยมวิทยาคุณ	105	2569	0	2569	2	10010010	1	1.66
อุบลราชธานี	เมืองอุบลราชธานี	ปทุม	6-5896-70044-62-3	นลินทิพย์ เกียรติสกุล	หญิง	ไทย	2014-04-18	2	10	ถนนสีลม	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	105	2569	0	2569	3	10010010	2	1.96
อุบลราชธานี	เมืองอุบลราชธานี	ปทุม	3-2779-88220-71-7	วาสนา เจริญชัย	หญิง	ไทย	2010-08-06	815/34	4	ถนนสรงประภา	\N	\N	1	ปัญหาครอบครัว	โรงเรียนมัธยมวิทยาคุณ	112	2569	0	2569	2	10010010	2	2.65
อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ	5-6727-82546-75-6	สุมาลี วงษ์สุวรรณ	หญิง	ไทย	2010-06-13	23/24	10	ถนนพหลโยธิน	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	112	2569	0	2569	3	10010010	2	1.65
อุบลราชธานี	เมืองอุบลราชธานี	ปทุม	1-1213-97461-23-1	ธนภัทร จันทร์แก้ว	ชาย	ไทย	2017-06-24	459	10	ถนนกาญจนาภิเษก	\N	\N	1	ปัญหาครอบครัว	โรงเรียนมัธยมวิทยาคุณ	101	2569	0	2569	3	10010010	1	2.56
อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง	8-8781-18602-78-8	พิพัฒน์ สุขสบาย	ชาย	ไทย	2015-09-08	181	10	ถ.บ้านโป่ง	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	104	2569	0	2569	1	10010010	1	2.22
อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน	3-1710-32470-42-5	สิรภพ วิไลวรรณ	ชาย	ไทย	2018-11-24	929/99	10	ถนนวิภาวดีรังสิต	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนมัธยมวิทยาคุณ	101	2569	0	2569	3	10010010	1	2.7
อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ	8-9365-38995-11-5	ทักษิณ ยิ้มแย้ม	ชาย	ไทย	2010-10-25	878	2	ถนนกาญจนาภิเษก	\N	\N	1	ปัญหาครอบครัว	โรงเรียนมัธยมวิทยาคุณ	112	2569	0	2569	2	10010010	1	1.58
อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ	1-2123-87811-37-9	ธนพัฒน์ เพ็งพา	ชาย	ไทย	2014-09-03	794/82	9	ถนนราษฎร์บูรณะ	\N	\N	1	ปัญหาครอบครัว	โรงเรียนมัธยมวิทยาคุณ	104	2569	0	2569	1	10010010	1	1.39
อุบลราชธานี	เมืองอุบลราชธานี	ปทุม	5-4145-63823-22-5	พรรษา สมบูรณ์	หญิง	ไทย	2014-12-18	503	7	ถนนสรงประภา	\N	\N	1	ปัญหาครอบครัว	โรงเรียนมัธยมวิทยาคุณ	104	2569	0	2569	3	10010010	2	1.11
อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน	4-2159-79711-92-5	กัญญา บุญรอด	หญิง	ไทย	2015-09-11	300	7	ถนนลาดพร้าว	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	103	2569	0	2569	2	10010010	2	2.7
อุบลราชธานี	เมืองอุบลราชธานี	ปทุม	7-9635-17659-23-8	ชาตรี ประสิทธิ์ผล	ชาย	ไทย	2014-10-19	469/70	7	ถนนสุดสาคร	\N	\N	1	ปัญหาครอบครัว	โรงเรียนมัธยมวิทยาคุณ	104	2569	0	2569	2	10010010	1	2.46
อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง	7-5963-20923-48-1	ปัณฑิตา ประสิทธิ์ผล	หญิง	ไทย	2012-01-28	483	5	ถนนชัยพฤกษ์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนมัธยมวิทยาคุณ	106	2569	0	2569	1	10010010	2	1.36
อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง	4-5275-87477-90-8	ณัฐวุฒิ ขาวสะอาด	ชาย	ไทย	2014-12-05	718	3	ถนนชัยพฤกษ์	\N	\N	1	ปัญหาครอบครัว	โรงเรียนมัธยมวิทยาคุณ	104	2569	0	2569	3	10010010	1	1.8
อุบลราชธานี	เมืองอุบลราชธานี	ปทุม	6-9309-52401-88-2	ณัฐพล วังขวา	ชาย	ไทย	2009-02-13	695	9	ถนนชัยพฤกษ์	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	113	2569	0	2569	1	10010010	1	1.98
อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง	4-5286-74356-77-7	อัมพร สุขสันต์	หญิง	ไทย	2009-03-15	153	7	ถนนบรมราชชนนี	\N	\N	1	ปัญหาครอบครัว	โรงเรียนมัธยมวิทยาคุณ	421	2569	0	2569	3	10010010	2	2.75
อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง	1-6529-11691-40-6	สุภัสสรา ชัยมงคล	หญิง	ไทย	2008-10-24	36	10	ถนนพหลโยธิน	\N	\N	1	ปัญหาครอบครัว	โรงเรียนมัธยมวิทยาคุณ	422	2569	0	2569	3	10010010	2	1.96
อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง	5-1355-99810-69-7	บุษยา สง่างาม	หญิง	ไทย	2011-03-12	463/39	8	ถนนสุขุมวิท	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนมัธยมวิทยาคุณ	111	2569	0	2569	1	10010010	2	2.73
อุบลราชธานี	เมืองอุบลราชธานี	ปทุม	3-6692-15668-92-8	ธัชพล ดีสมัย	ชาย	ไทย	2010-11-04	267	3	ถนนบรมราชชนนี	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	112	2569	0	2569	3	10010010	1	1.68
อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน	2-7435-76457-42-8	เอกพงษ์ บุญรอด	ชาย	ไทย	2006-08-10	63	10	ถนนสรงประภา	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนมัธยมวิทยาคุณ	423	2569	0	2569	2	10010010	1	1.41
อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง	1-4151-47414-32-9	ชนิดา ศรีสุข	หญิง	ไทย	2017-04-13	834	7	ถ.ประชาสามัคคี	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	102	2569	0	2569	1	10010010	2	1.53
อุบลราชธานี	เมืองอุบลราชธานี	ปทุม	3-8210-90239-21-3	วรพล จันทร์แก้ว	ชาย	ไทย	2017-05-08	425/36	1	ถนนโชคชัย	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	101	2569	0	2569	3	10010010	1	1.69
อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ	5-2997-17578-17-4	จิราพร คงพิทักษ์	หญิง	ไทย	2016-01-06	196/44	4	ถนนอ่อนนุช	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนมัธยมวิทยาคุณ	102	2569	0	2569	1	10010010	2	2.59
อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง	2-2390-57330-71-2	สุดารัตน์ สีดา	หญิง	ไทย	2015-05-28	962/87	8	ถนนเจริญกรุง	\N	\N	2	ยากจน	โรงเรียนมัธยมวิทยาคุณ	103	2569	0	2569	3	10010010	2	1.65
อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ	4-7261-97769-79-3	นลินทิพย์ ปัญญาดี	หญิง	ไทย	2011-09-14	268	8	ถนนศรีนครินทร์	\N	\N	3	ย้ายถิ่นฐาน	โรงเรียนมัธยมวิทยาคุณ	112	2569	0	2569	3	10010010	2	1.11
\.


--
-- Data for Name: student_term; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.student_term ("AcademicYear_Onec", "Semester_Onec", "DepartmentID_Onec", "SchoolID_Onec", "PersonID_Onec", "PassportNumber_Onec", "PrefixID_Onec", "FirstName_Onec", "MiddleName_Onec", "LastName_Onec", "GenderID_Onec", "NationalityID_Onec", "DisabilityID_Onec", "DisadvantageEducationID_Onec", "VillageNumber_Onec", "Street_Onec", "Soi_Onec", "Trok_Onec", "SubDistrictID_Onec", "SchoolAdmissionYear_Onec", "GradeLevelID_Onec", "RoomID_Onec", "GPAX_Onec", "StudentStatusID_Onec", "ProvinceNameThai_Onec", "DistrictNameThai_Onec", "SubDistrictNameThai_Onec") FROM stdin;
2569	1	3	10010001	7-9379-25157-59-4	\N	1	ชนะชัย	\N	คงพิทักษ์	1	1	0	0	5	ถนนลาดพร้าว	\N	\N	1004	2559	113	3	3.57	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	6-3041-49363-74-5	\N	2	พิมพ์ชนก	\N	เกียรติสกุล	2	1	0	0	7	ถนนห้วยแก้ว	\N	\N	1004	2556	423	3	3.84	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	7-3851-90676-82-5	\N	3	ดวงใจ	\N	ศักดิ์สิทธิ์	2	1	0	0	7	ถนนประดิษฐ์มนูธรรม	\N	\N	1002	2558	421	2	3.33	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	6-8618-67905-66-4	\N	1	พิพัฒน์	\N	พันธุ์ดี	1	1	0	0	9	ถ.เอกชัย	\N	\N	1002	2567	101	3	3.41	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	6-2530-40784-96-5	\N	1	บุญยิ่ง	\N	วงษ์สุวรรณ	1	1	0	0	4	ถนนอ่อนนุช	\N	\N	1003	2562	106	3	3.27	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	2-8461-64321-90-4	\N	1	ภูมิพัฒน์	\N	ทองดี	1	1	0	0	7	ถ.บ้านโป่ง	\N	\N	1002	2567	101	3	3.77	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	8-1822-83060-41-2	\N	2	นลินทิพย์	\N	อ่อนน้อม	2	1	0	0	8	ถนนสรงประภา	\N	\N	1001	2564	104	2	2.59	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	7-9976-68446-30-8	\N	3	รุ่งอรุณ	\N	งามดี	2	1	0	0	8	ถนนเยาวราช	\N	\N	1004	2562	106	3	3.78	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	5-4841-45614-52-6	\N	1	วสันต์	\N	นามมนตรี	1	1	0	0	9	ถนนบรมราชชนนี	\N	\N	1004	2567	103	2	2.99	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	7-7678-53369-79-8	\N	1	อภิวัฒน์	\N	อินทร์ชัย	1	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	1004	2558	421	3	2.43	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	6-5892-61116-63-9	\N	1	รชานนท์	\N	เจริญชัย	1	1	0	0	9	ถนนสีลม	\N	\N	1001	2560	112	2	2.95	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	7-3704-71261-26-9	\N	3	พรทิพย์	\N	สกุลดี	2	1	0	0	1	ถนนสุดสาคร	\N	\N	1004	2560	112	2	2.67	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	5-7211-52906-37-8	\N	1	ศุภณัฐ	\N	อ่อนน้อม	1	1	0	0	6	ถนนช้างเผือก	\N	\N	1004	2559	113	2	2.36	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	1-6733-39389-93-2	\N	3	อภิญญา	\N	หอมหวาน	2	1	0	0	1	ถนนสุขุมวิท	\N	\N	1001	2556	423	1	3.5	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	8-2874-83920-37-8	\N	1	ชินดนัย	\N	สุขสันต์	1	1	0	0	5	ถนนกลางเมือง	\N	\N	1001	2556	423	1	2.48	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	1-6111-85470-96-7	\N	1	ไกรวุฒิ	\N	คงพิทักษ์	1	1	0	0	7	ถนนอ่อนนุช	\N	\N	1001	2556	423	2	2.22	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	2-1672-55508-78-7	\N	1	มานพ	\N	สุดสวย	1	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	1002	2559	113	3	3.54	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	8-3506-67080-32-9	\N	3	พิมพ์ชนก	\N	ปัญญาดี	2	1	0	0	5	ถนนนวมินทร์	\N	\N	1004	2560	112	2	3.92	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	2-5569-69087-41-8	\N	3	พรรษา	\N	ปัญญาดี	2	1	0	0	10	ถนนบายพาส	\N	\N	1003	2561	111	1	3.7	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	5-6576-46655-86-5	\N	3	ณัฐนิชา	\N	มงคล	2	1	0	0	9	ถนนพหลโยธิน	\N	\N	1003	2556	423	2	2.42	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	8-9041-68743-12-2	\N	1	ศุภณัฐ	\N	พงษ์ไพร	1	1	0	0	5	ถนนสีลม	\N	\N	1004	2556	423	3	3.52	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	7-6419-56112-99-8	\N	2	ดวงใจ	\N	ขาวสะอาด	2	1	0	0	5	ถนนนิมมานเหมินท์	\N	\N	1003	2559	113	3	3.06	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	3-4138-38361-71-5	\N	2	พรทิพย์	\N	สีดา	2	1	0	0	10	ถนนเจริญกรุง	\N	\N	1002	2566	102	1	3.61	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	3-5494-15965-16-9	\N	2	ภัทรวดี	\N	พันธุ์ดี	2	1	0	0	5	ถนนสรงประภา	\N	\N	1002	2562	106	1	2.6	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	3-1841-43092-71-2	\N	2	ภัทรวดี	\N	ดำรงค์	2	1	0	0	2	ถนนสุดสาคร	\N	\N	1003	2560	112	2	2.88	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	4-2940-83147-63-4	\N	2	ชลธิชา	\N	รักษ์ไทย	2	1	0	0	9	ถนนบายพาส	\N	\N	1002	2561	111	2	2.35	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	2-4404-91987-37-5	\N	3	ลลิตา	\N	ชูศรี	2	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	1004	2558	421	3	3.24	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	8-5771-14278-39-5	\N	1	ธนาธิป	\N	ศักดิ์สิทธิ์	1	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	1001	2567	101	1	3.11	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	4-7965-25043-79-4	\N	1	ณัฐวรรธน์	\N	อินทร์ชัย	1	1	0	0	3	ถนนกาญจนาภิเษก	\N	\N	1003	2562	106	3	3.61	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	5-8195-26299-69-5	\N	1	วรากร	\N	แสงสว่าง	1	1	0	0	7	ถนนกาญจนาภิเษก	\N	\N	1002	2560	112	3	3.5	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	5-1423-21970-39-1	\N	2	ลลิตา	\N	คงพิทักษ์	2	1	0	0	5	ถนนลาดพร้าว	\N	\N	1001	2558	421	3	2.64	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	7-9056-21959-70-6	\N	1	สุรชัย	\N	พรประเสริฐ	1	1	0	0	7	ถนนช้างเผือก	\N	\N	1004	2561	111	1	3.99	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	5-7561-82102-14-8	\N	2	รุ่งอรุณ	\N	มงคล	2	1	0	0	2	ถนนห้วยแก้ว	\N	\N	1002	2560	112	2	3.39	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	8-7770-17104-34-9	\N	2	ชนิดา	\N	สง่างาม	2	1	0	0	6	ถ.บ้านโป่ง	\N	\N	1004	2562	106	1	3.32	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	8-8941-25915-13-4	\N	2	ประภา	\N	คงมั่น	2	1	0	0	3	ถนนนิมมานเหมินท์	\N	\N	1003	2567	103	1	3.87	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	2-3522-75323-47-9	\N	1	นพรัตน์	\N	รุ่งเรือง	1	1	0	0	5	ถนนมาลัยแมน	\N	\N	1001	2558	421	1	2.92	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	3-2143-46208-63-6	\N	2	กาญจนา	\N	บริบูรณ์	2	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	1002	2567	103	1	3.86	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	8-3434-68529-78-8	\N	1	ศิวกร	\N	สีดา	1	1	0	0	6	ถนนช้างเผือก	\N	\N	1003	2559	113	3	4	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	7-1715-51704-70-7	\N	3	พรรษา	\N	ดีสมัย	2	1	0	0	7	ถนนชัยพฤกษ์	\N	\N	1002	2556	423	2	2.47	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	8-1251-28894-62-3	\N	2	ปัณฑิตา	\N	วิริยะ	2	1	0	0	2	ถ.เอกชัย	\N	\N	1003	2560	112	2	2.2	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	7-6188-92155-72-9	\N	3	เกวลิน	\N	อ่อนน้อม	2	1	0	0	1	ถนนงามวงศ์วาน	\N	\N	1001	2558	421	3	3.72	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	2-2646-68153-31-5	\N	1	วสันต์	\N	สุจริต	1	1	0	0	1	ถนนลาดพร้าว	\N	\N	1003	2566	102	3	2.64	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	7-3950-32280-32-2	\N	3	วรรณภา	\N	สุวรรณภูมิ	2	1	0	0	10	ถนนบายพาส	\N	\N	1003	2557	422	1	2.49	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	8-5183-97404-11-8	\N	1	วุฒิพงษ์	\N	ชูศรี	1	1	0	0	5	ถนนนวมินทร์	\N	\N	1002	2558	421	2	3.28	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	7-5097-69878-48-4	\N	1	วรากร	\N	มีสุข	1	1	0	0	7	ถ.เอกชัย	\N	\N	1003	2566	102	2	3.46	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	5-1359-96275-60-5	\N	1	ปัณณทัต	\N	เจริญชัย	1	1	0	0	1	ถนนรัตนาธิเบศร์	\N	\N	1003	2560	112	2	3.99	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	5-3240-92345-22-1	\N	2	วิมลรัตน์	\N	คงพิทักษ์	2	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	1003	2558	421	3	2.38	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	7-3877-36318-26-9	\N	1	มานพ	\N	เกียรติสกุล	1	1	0	0	6	ถนนเจริญกรุง	\N	\N	1002	2567	103	2	2.79	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	2-8673-19869-28-4	\N	3	รัตนาภรณ์	\N	ปัญญาดี	2	1	0	0	7	ถนนประดิษฐ์มนูธรรม	\N	\N	1004	2560	112	3	3.74	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	5-7242-93695-57-2	\N	3	กัญญาณัฐ	\N	สุขสบาย	2	1	0	0	4	ถ.เอกชัย	\N	\N	1003	2567	103	1	3.02	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	8-5951-95097-62-2	\N	1	ทักษิณ	\N	ศักดิ์สิทธิ์	1	1	0	0	3	ถนนลาดพร้าว	\N	\N	1003	2563	105	1	3.3	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	3-7367-69459-57-9	\N	1	พิพัฒน์	\N	กิตติคุณ	1	1	0	0	7	ถนนชัยพฤกษ์	\N	\N	1001	2567	101	1	3.83	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	5-1536-58566-37-8	\N	2	นวลจันทร์	\N	สุขสันต์	2	1	0	0	8	ถนนสุรวงศ์	\N	\N	1004	2560	112	2	3.88	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	2-8450-22015-94-4	\N	3	ภัทรวดี	\N	บุญรอด	2	1	0	0	10	ถนนสุขุมวิท	\N	\N	1003	2564	104	2	2.7	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	4-4538-40539-52-3	\N	1	ชาตรี	\N	พงษ์ไพร	1	1	0	0	10	ถนนพหลโยธิน	\N	\N	1002	2567	103	1	2.32	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	1-3159-11947-55-4	\N	2	นันทพร	\N	บุญรอด	2	1	0	0	10	ถนนห้วยแก้ว	\N	\N	1003	2560	112	1	3.32	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	2-2041-72422-67-6	\N	1	ธนาธิป	\N	หอมหวาน	1	1	0	0	9	ถนนเพชรเกษม	\N	\N	1001	2558	421	3	2.84	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	1-1996-72781-61-7	\N	2	วาสนา	\N	นิ่มนวล	2	1	0	0	2	ถ.บ้านโป่ง	\N	\N	1001	2556	423	2	2.92	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	6-7240-88301-77-5	\N	2	ชลธิชา	\N	วิไลวรรณ	2	1	0	0	8	ถนนโชคชัย	\N	\N	1002	2567	101	1	2.91	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	7-6553-69441-61-7	\N	2	ภัทรวดี	\N	มงคล	2	1	0	0	2	ถนนห้วยแก้ว	\N	\N	1002	2557	422	2	3.78	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	2-2527-66606-22-6	\N	3	ชนิดา	\N	เกียรติสกุล	2	1	0	0	3	ถนนประดิษฐ์มนูธรรม	\N	\N	1002	2567	101	1	2.64	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	7-1842-47700-86-5	\N	1	มานพ	\N	ศักดิ์สิทธิ์	1	1	0	0	6	ถนนเพชรเกษม	\N	\N	1003	2557	422	2	2.71	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	6-2882-46512-83-4	\N	1	อภิวัฒน์	\N	เพียรดี	1	1	0	0	7	ถนนประดิษฐ์มนูธรรม	\N	\N	1004	2566	102	1	3.03	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	5-6567-56009-10-3	\N	1	ไกรวุฒิ	\N	เพียรดี	1	1	0	0	3	ถนนสุดสาคร	\N	\N	1003	2563	105	1	2.55	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	7-7878-69460-53-3	\N	1	อภิวัฒน์	\N	ทั่วถึง	1	1	0	0	6	ถนนนิมมานเหมินท์	\N	\N	1001	2563	105	3	3.06	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	2-5458-68079-94-7	\N	2	ดรุณี	\N	แสงสว่าง	2	1	0	0	8	ถ.ประชาสามัคคี	\N	\N	1002	2558	421	3	2.1	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	8-9633-97442-49-1	\N	2	อภิญญา	\N	งามดี	2	1	0	0	4	ถนนสุดสาคร	\N	\N	1001	2563	105	2	2.22	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	5-6375-25726-10-8	\N	1	ธนภัทร	\N	คงมั่น	1	1	0	0	7	ถนนศรีนครินทร์	\N	\N	1003	2559	113	1	3.53	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	6-2180-62044-15-7	\N	1	วีรชัย	\N	บุญรอด	1	1	0	0	1	ถ.รัฐพัฒนา	\N	\N	1002	2567	103	3	3.7	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	7-5743-25096-61-1	\N	1	ณัฐวุฒิ	\N	ดำรงค์	1	1	0	0	6	ถนนราษฎร์บูรณะ	\N	\N	1004	2558	421	2	3.42	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	7-9584-20308-60-5	\N	3	ดวงใจ	\N	วงษ์สุวรรณ	2	1	0	0	6	ถนนสีลม	\N	\N	1004	2557	422	1	2.87	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	6-6752-94599-28-4	\N	2	รัตนาภรณ์	\N	วิริยะ	2	1	0	0	2	ถนนชัยพฤกษ์	\N	\N	1001	2567	101	3	2.79	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	8-8601-83889-84-8	\N	2	กุลธิดา	\N	คงพิทักษ์	2	1	0	0	10	ถนนห้วยแก้ว	\N	\N	1002	2563	105	1	3.9	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	5-1920-56129-74-2	\N	3	นันทพร	\N	ใจดี	2	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	1004	2563	105	3	2.61	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	2-9307-60394-69-9	\N	2	ปัณฑิตา	\N	เกียรติสกุล	2	1	0	0	1	ถ.ประชาสามัคคี	\N	\N	1003	2556	423	3	3.73	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	8-2695-55015-20-9	\N	1	ณัฐวุฒิ	\N	คงพิทักษ์	1	1	0	0	3	ถนนลาดพร้าว	\N	\N	1004	2567	101	1	3.94	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	6-7108-47079-59-7	\N	1	สมศักดิ์	\N	มีสุข	1	1	0	0	6	ถนนรัตนาธิเบศร์	\N	\N	1004	2560	112	3	3.22	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	3-6461-20682-84-3	\N	3	ชลธิชา	\N	จันทร์แก้ว	2	1	0	0	6	ถนนนิมมานเหมินท์	\N	\N	1004	2557	422	2	3.45	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	2-7937-76648-56-1	\N	2	อรณิชา	\N	ขาวสะอาด	2	1	0	0	6	ถนนนิมมานเหมินท์	\N	\N	1004	2558	421	1	3.34	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	3-2264-48770-22-9	\N	1	นรวิชญ์	\N	ชัยมงคล	1	1	0	0	9	ถนนเจริญกรุง	\N	\N	1004	2560	112	1	4	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010009	5-9971-66780-45-2	\N	1	พิพัฒน์	\N	ธนาคาร	1	1	0	0	6	ถนนสาทร	\N	\N	9203	2566	102	2	3.92	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	5	10010001	3-3712-67366-15-7	\N	1	บุญยิ่ง	\N	ชัยมงคล	1	1	0	0	6	ถนนสุรวงศ์	\N	\N	1002	2556	423	2	2.31	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	8-4178-58213-96-8	\N	3	เพ็ญพักตร์	\N	งามดี	2	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	1004	2561	111	3	2.63	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	1-8873-58655-80-2	\N	3	วาสนา	\N	เพ็งพา	2	1	0	0	9	ถนนรามคำแหง	\N	\N	1002	2557	422	1	3.75	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	2-4637-69130-54-1	\N	2	กัญญาณัฐ	\N	นามมนตรี	2	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	1004	2561	111	1	3.7	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	6-2623-95191-52-3	\N	3	วาสนา	\N	พงษ์ไพร	2	1	0	0	3	ถนนลาดพร้าว	\N	\N	1004	2567	101	2	2.84	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	2-1311-43544-37-3	\N	2	กาญจนา	\N	งามดี	2	1	0	0	9	ถนนเจริญกรุง	\N	\N	1004	2562	106	3	2.01	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	8-2029-24530-73-9	\N	3	สุภัสสรา	\N	พงษ์ไพร	2	1	0	0	1	ถนนโชคชัย	\N	\N	1003	2558	421	1	2.48	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	4-7825-34551-95-2	\N	1	สมศักดิ์	\N	รักษ์ไทย	1	1	0	0	9	ถนนกลางเมือง	\N	\N	1003	2562	106	1	3.23	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	7-7116-43246-12-6	\N	1	คุณากร	\N	บุญรอด	1	1	0	0	2	ถนนมิตรภาพ	\N	\N	1001	2561	111	2	2.28	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	3-1726-56176-79-6	\N	1	วรพล	\N	เพียรดี	1	1	0	0	3	ถ.รัฐพัฒนา	\N	\N	1001	2567	103	3	3.56	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	8-1605-48462-35-1	\N	2	สมหญิง	\N	พรสวรรค์	2	1	0	0	4	ถนนลาดพร้าว	\N	\N	1002	2562	106	3	3.55	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	4-5687-56789-16-6	\N	3	สุดารัตน์	\N	ปัญญาดี	2	1	0	0	5	ถนนรามคำแหง	\N	\N	1004	2563	105	1	3.51	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	8-9151-58148-76-5	\N	3	อัมพร	\N	ทั่วถึง	2	1	0	0	2	ถนนอุดรดุษฎี	\N	\N	1004	2557	422	2	3.95	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	2-6372-96628-47-5	\N	1	ภัคพล	\N	คงพิทักษ์	1	1	0	0	8	ถนนอุดรดุษฎี	\N	\N	1002	2564	104	2	2.78	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	6-8126-45986-91-1	\N	1	อนุชา	\N	มีสุข	1	1	0	0	2	ถนนสุดสาคร	\N	\N	1003	2567	103	1	3.51	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	1-3068-18812-40-6	\N	2	วาสนา	\N	มณีรัตน์	2	1	0	0	6	ถนนบายพาส	\N	\N	1002	2556	423	3	3.56	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	2-3255-79397-56-7	\N	1	ไกรวุฒิ	\N	รักษ์ไทย	1	1	0	0	6	ถนนกาญจนาภิเษก	\N	\N	1004	2563	105	2	2.89	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	2-5288-44116-67-4	\N	1	รัฐนนท์	\N	มณีรัตน์	1	1	0	0	10	ถนนวิภาวดีรังสิต	\N	\N	1002	2556	423	3	2.77	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	8-2438-99381-50-6	\N	2	กุลธิดา	\N	บุญมี	2	1	0	0	2	ถนนประดิษฐ์มนูธรรม	\N	\N	1001	2557	422	1	3.8	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	4-3275-41029-73-1	\N	2	สุดารัตน์	\N	วังขวา	2	1	0	0	6	ถนนประดิษฐ์มนูธรรม	\N	\N	1002	2556	423	3	2.45	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	8-9612-63843-62-2	\N	2	พรรษา	\N	นิ่มนวล	2	1	0	0	3	ถนนห้วยแก้ว	\N	\N	1001	2567	103	2	2.92	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	3-3114-66704-74-1	\N	1	กวินท์	\N	บริบูรณ์	1	1	0	0	2	ถนนเจริญกรุง	\N	\N	1003	2567	103	3	3.35	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	5-2292-42847-35-9	\N	1	พิพัฒน์	\N	เพ็งพา	1	1	0	0	5	ถนนสรงประภา	\N	\N	1002	2558	421	3	2.45	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	6-1674-13718-20-1	\N	2	เพ็ญพักตร์	\N	วิริยะ	2	1	0	0	10	ถนนเยาวราช	\N	\N	1002	2562	106	3	2.31	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	5-5949-73300-41-7	\N	1	ชูเกียรติ	\N	ดำรงค์	1	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	1004	2566	102	3	2.55	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	4-6573-89516-28-6	\N	1	อนุชา	\N	แสงสว่าง	1	1	0	0	6	ถนนมิตรภาพ	\N	\N	1002	2556	423	2	2.97	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	5-8366-42495-28-2	\N	3	อรณิชา	\N	วิริยะ	2	1	0	0	1	ถนนวิภาวดีรังสิต	\N	\N	1001	2564	104	1	3.04	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	4-3610-75308-75-8	\N	3	เพ็ญพักตร์	\N	พงษ์ไพร	2	1	0	0	8	ถนนนิมมานเหมินท์	\N	\N	1002	2558	421	3	3.44	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	1-1828-46877-73-8	\N	2	ณัฐนิชา	\N	ประสิทธิ์ผล	2	1	0	0	5	ถนนนวมินทร์	\N	\N	1004	2558	421	1	3.17	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	7-6995-15930-61-1	\N	1	ชนะชัย	\N	สกุลดี	1	1	0	0	10	ถนนประดิษฐ์มนูธรรม	\N	\N	1002	2566	102	3	3.05	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	5-2946-26864-22-7	\N	1	ประพันธ์	\N	ศักดิ์สิทธิ์	1	1	0	0	6	ถนนช้างเผือก	\N	\N	1003	2567	103	2	3.11	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	3-6456-72094-76-8	\N	2	ประภา	\N	ดีสมัย	2	1	0	0	3	ถนนโชคชัย	\N	\N	1004	2559	113	1	2.09	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	5-6511-76494-75-9	\N	1	ณัฐวุฒิ	\N	นิ่มนวล	1	1	0	0	8	ถนนนิมมานเหมินท์	\N	\N	1003	2558	421	2	3.98	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	1-8775-44803-93-4	\N	3	ณัฐนิชา	\N	ชัยมงคล	2	1	0	0	1	ถ.เอกชัย	\N	\N	1001	2557	422	3	2.62	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	2-4125-12482-66-6	\N	1	คุณากร	\N	ยิ้มแย้ม	1	1	0	0	7	ถนนชัยพฤกษ์	\N	\N	1004	2567	101	3	2.86	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	4-6325-96799-71-9	\N	2	ดวงใจ	\N	รุ่งเรือง	2	1	0	0	7	ถนนห้วยแก้ว	\N	\N	1004	2558	421	3	2.28	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	5-8932-35200-41-5	\N	1	เจษฎา	\N	บุญรอด	1	1	0	0	9	ถนนนิมมานเหมินท์	\N	\N	1003	2559	113	2	3.35	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	6-8861-55718-81-5	\N	1	พิพัฒน์	\N	สง่างาม	1	1	0	0	5	ถนนรามคำแหง	\N	\N	1003	2567	103	3	3.47	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	2-6674-67983-93-5	\N	3	จิราพร	\N	สง่างาม	2	1	0	0	8	ถนนสาทร	\N	\N	1002	2560	112	1	2.58	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	4-4972-16653-95-9	\N	1	ปิยังกูร	\N	นามมนตรี	1	1	0	0	4	ถนนสีลม	\N	\N	1003	2563	105	1	3.23	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	3-1084-82135-30-7	\N	1	ชนะชัย	\N	รุ่งเรือง	1	1	0	0	8	ถ.เอกชัย	\N	\N	1003	2559	113	1	3.36	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	2-4804-80143-14-3	\N	1	ทัศนัย	\N	พันธุ์ดี	1	1	0	0	7	ถนนศรีนครินทร์	\N	\N	1003	2564	104	3	2.31	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	5-1613-11214-48-2	\N	1	ธัชพล	\N	ธนาคาร	1	1	0	0	6	ถนนวิภาวดีรังสิต	\N	\N	1004	2562	106	3	3.92	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	6-3662-70150-92-5	\N	3	นวลจันทร์	\N	บุญมี	2	1	0	0	3	ถนนพหลโยธิน	\N	\N	1004	2562	106	1	3.62	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	7-2562-34219-27-8	\N	2	วิมลรัตน์	\N	สมบูรณ์	2	1	0	0	6	ถนนสุรวงศ์	\N	\N	1004	2558	421	3	2.66	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	5-1187-44282-93-6	\N	1	สิรภพ	\N	เจริญชัย	1	1	0	0	4	ถนนรัตนาธิเบศร์	\N	\N	1002	2562	106	2	3.91	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	5-2923-93717-47-6	\N	1	เจษฎา	\N	ขาวสะอาด	1	1	0	0	10	ถนนสีลม	\N	\N	1002	2564	104	3	3.1	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	6-7813-81989-70-9	\N	1	ปรเมศวร์	\N	ลือชา	1	1	0	0	4	ถนนสุรวงศ์	\N	\N	1002	2561	111	3	3.98	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	4-9792-29641-31-6	\N	1	คุณากร	\N	มีสุข	1	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	1003	2567	101	3	2.67	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	1-8429-27294-75-7	\N	1	ณัฐวรรธน์	\N	คงมั่น	1	1	0	0	8	ถนนรัตนาธิเบศร์	\N	\N	1004	2567	101	3	3.17	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	4-2196-15936-64-6	\N	3	แสงดาว	\N	สีดา	2	1	0	0	2	ถนนนวมินทร์	\N	\N	1001	2557	422	2	3.63	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	3-7887-59081-58-8	\N	1	วรากร	\N	ลือชา	1	1	0	0	7	ถนนบายพาส	\N	\N	1001	2567	103	2	2.52	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	7-9664-26691-38-1	\N	1	ณัฐวรรธน์	\N	เพียรดี	1	1	0	0	1	ถนนนิมมานเหมินท์	\N	\N	1002	2561	111	1	2.52	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	3-5516-34704-24-1	\N	3	แสงดาว	\N	บุญรอด	2	1	0	0	7	ถนนสุขุมวิท	\N	\N	1004	2559	113	1	2.92	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	1-5009-15798-61-8	\N	1	นรวิชญ์	\N	ใจดี	1	1	0	0	4	ถนนนวมินทร์	\N	\N	1001	2556	423	1	2.89	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	4-6224-85690-86-6	\N	1	ทัศนัย	\N	สง่างาม	1	1	0	0	4	ถนนนิมมานเหมินท์	\N	\N	1001	2563	105	3	3.99	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	3-7999-82856-73-1	\N	1	บุญยิ่ง	\N	พรประเสริฐ	1	1	0	0	6	ถนนบายพาส	\N	\N	1002	2566	102	2	2.91	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	8-4948-39536-48-3	\N	3	ดวงใจ	\N	รุ่งเรือง	2	1	0	0	8	ถนนรัตนาธิเบศร์	\N	\N	1002	2567	103	2	2.53	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	2-8369-58637-21-9	\N	2	สุนิสา	\N	เจริญชัย	2	1	0	0	4	ถนนรัตนาธิเบศร์	\N	\N	1002	2564	104	1	2.79	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	4-8854-37379-52-5	\N	2	นภาพร	\N	ใจดี	2	1	0	0	1	ถนนสาทร	\N	\N	1002	2564	104	3	3.41	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	4-7498-41369-80-6	\N	1	เอกพงษ์	\N	ศรีสุข	1	1	0	0	5	ถนนบายพาส	\N	\N	1004	2556	423	3	3.21	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	8-2615-71537-50-4	\N	3	บุษยา	\N	ขาวสะอาด	2	1	0	0	6	ถนนห้วยแก้ว	\N	\N	1003	2562	106	3	3.77	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	7-5836-29976-35-6	\N	2	ปัณฑิตา	\N	ทั่วถึง	2	1	0	0	4	ถนนบายพาส	\N	\N	1002	2561	111	2	3.2	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	8-8550-32050-55-3	\N	1	วุฒิพงษ์	\N	ศักดิ์สิทธิ์	1	1	0	0	3	ถนนนวมินทร์	\N	\N	1003	2556	423	2	3.93	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	1-7756-28021-90-4	\N	2	ธัญชนก	\N	พรประเสริฐ	2	1	0	0	2	ถนนชัยพฤกษ์	\N	\N	1001	2566	102	3	2.57	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	8-8993-12061-10-9	\N	1	นรวิชญ์	\N	วิริยะ	1	1	0	0	9	ถนนมาลัยแมน	\N	\N	1004	2567	101	1	3.43	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	7-3937-24026-22-9	\N	1	ภูมิพัฒน์	\N	พรประเสริฐ	1	1	0	0	3	ถนนสุรวงศ์	\N	\N	1003	2557	422	2	2.03	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	2-7112-63218-68-4	\N	1	ทักษิณ	\N	พรประเสริฐ	1	1	0	0	4	ถนนนิมมานเหมินท์	\N	\N	1003	2563	105	2	3.59	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	8-1919-93459-11-3	\N	1	ชัยชนะ	\N	มงคล	1	1	0	0	2	ถ.บ้านโป่ง	\N	\N	1001	2562	106	2	2.76	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	8-5441-16102-19-5	\N	3	นวลจันทร์	\N	ดำรงค์	2	1	0	0	9	ถนนลาดพร้าว	\N	\N	1001	2557	422	1	2.46	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	7-2260-49226-30-4	\N	1	ณัฐวุฒิ	\N	มณีรัตน์	1	1	0	0	10	ถนนบายพาส	\N	\N	1002	2563	105	1	3.5	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	1-2600-67290-39-2	\N	2	นภาพร	\N	ธนาคาร	2	1	0	0	6	ถนนสุดสาคร	\N	\N	1001	2566	102	3	3.96	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	7-8075-34345-97-7	\N	3	ณัฐนิชา	\N	ธนาคาร	2	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	1004	2567	101	1	3.03	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	3-7383-51507-56-2	\N	1	สมศักดิ์	\N	ใจดี	1	1	0	0	2	ถนนพหลโยธิน	\N	\N	1001	2566	102	1	3.07	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	7-8353-83005-81-9	\N	3	ลลิตา	\N	งามดี	2	1	0	0	7	ถนนเพชรเกษม	\N	\N	1003	2562	106	1	2.17	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	7-1202-48253-62-7	\N	1	ศุภณัฐ	\N	สุวรรณภูมิ	1	1	0	0	2	ถนนประดิษฐ์มนูธรรม	\N	\N	1001	2558	421	3	3.57	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	5-5397-74634-28-2	\N	1	สุทธิพงษ์	\N	พรประเสริฐ	1	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	1002	2562	106	1	2.28	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	8-4203-70012-23-3	\N	3	สุนิสา	\N	ลือชา	2	1	0	0	5	ถนนพหลโยธิน	\N	\N	1001	2562	106	2	3.89	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	3-5922-52030-87-4	\N	3	เกวลิน	\N	พรสวรรค์	2	1	0	0	8	ถนนห้วยแก้ว	\N	\N	1003	2563	105	2	2.86	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	6-7161-46739-60-6	\N	1	ธัชพล	\N	วิไลวรรณ	1	1	0	0	2	ถนนอ่อนนุช	\N	\N	1003	2559	113	3	3.56	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010009	2-9531-46344-15-7	\N	2	ณัฐนิชา	\N	เพียรดี	2	1	0	0	4	ถนนชัยพฤกษ์	\N	\N	9203	2563	105	2	3.47	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010001	5-2133-63627-96-8	\N	1	ณัฐวรรธน์	\N	สง่างาม	1	1	0	0	3	ถนนนิมมานเหมินท์	\N	\N	1001	2557	422	3	2.42	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	8-7566-80040-74-7	\N	1	สิรภพ	\N	เพียรดี	1	1	0	0	9	ถนนลาดพร้าว	\N	\N	1002	2557	422	2	2.15	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	1-7547-53463-65-2	\N	2	ดวงใจ	\N	จันทร์แก้ว	2	1	0	0	1	ถนนเพชรเกษม	\N	\N	1002	2559	113	1	3.29	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	3-6651-13219-71-2	\N	2	พรทิพย์	\N	มีสุข	2	1	0	0	5	ถนนมาลัยแมน	\N	\N	1003	2557	422	2	3.54	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	4-9537-73298-54-8	\N	1	รัฐนนท์	\N	สุขสันต์	1	1	0	0	2	ถ.ประชาสามัคคี	\N	\N	1002	2567	101	2	3.01	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	2-3692-41970-76-3	\N	2	ชนิดา	\N	ขาวสะอาด	2	1	0	0	9	ถนนราษฎร์บูรณะ	\N	\N	1001	2567	101	1	3.77	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	7-7481-13826-88-4	\N	3	กัญญา	\N	บริบูรณ์	2	1	0	0	8	ถนนอุดรดุษฎี	\N	\N	1002	2562	106	3	2.37	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	3-6993-52727-35-8	\N	2	พิมพ์ชนก	\N	คงมั่น	2	1	0	0	2	ถนนเยาวราช	\N	\N	1003	2556	423	3	2.2	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	6-6766-70012-89-3	\N	3	ปิยนุช	\N	คงพิทักษ์	2	1	0	0	5	ถนนบรมราชชนนี	\N	\N	1004	2564	104	2	3.26	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	3-9369-60916-63-3	\N	1	ณัฐวุฒิ	\N	ศรีสุข	1	1	0	0	10	ถนนบายพาส	\N	\N	1002	2567	103	1	2.53	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	3-4065-51232-67-1	\N	3	ธัญชนก	\N	ยิ้มแย้ม	2	1	0	0	6	ถนนพหลโยธิน	\N	\N	1002	2557	422	1	2.98	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	7-9056-64477-66-8	\N	2	อรณิชา	\N	ปัญญาดี	2	1	0	0	3	ถนนบรมราชชนนี	\N	\N	1004	2558	421	3	3.31	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	5-3755-69942-82-8	\N	1	ทัศนัย	\N	อินทร์ชัย	1	1	0	0	9	ถนนโชคชัย	\N	\N	1003	2557	422	2	2.45	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	1-8231-81611-37-7	\N	1	สุทธิพงษ์	\N	ศรีสุข	1	1	0	0	2	ถนนสุรวงศ์	\N	\N	1003	2567	103	2	3.18	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	2-4882-37509-85-6	\N	3	ปัณฑิตา	\N	หอมหวาน	2	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	1003	2560	112	2	3.73	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	5-9827-32069-51-5	\N	1	ทักษิณ	\N	บุญมี	1	1	0	0	5	ถนนกาญจนาภิเษก	\N	\N	1002	2564	104	1	3.23	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	3-3174-42725-28-6	\N	1	ปรเมศวร์	\N	งามดี	1	1	0	0	4	ถนนสุดสาคร	\N	\N	1004	2559	113	2	3.73	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	2-7600-77582-45-6	\N	3	นันทพร	\N	ยิ้มแย้ม	2	1	0	0	8	ถ.บ้านโป่ง	\N	\N	1004	2564	104	2	2.34	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	6-2037-80048-60-4	\N	2	มาลัย	\N	สง่างาม	2	1	0	0	7	ถนนสาทร	\N	\N	1001	2560	112	3	3.33	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	8-6631-99463-16-1	\N	3	อภิญญา	\N	สุขสันต์	2	1	0	0	2	ถ.รัฐพัฒนา	\N	\N	1003	2563	105	3	3.16	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	7-4314-27290-93-5	\N	1	รัฐนนท์	\N	มงคล	1	1	0	0	3	ถนนกาญจนาภิเษก	\N	\N	1002	2562	106	2	2	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	3-1848-61949-90-5	\N	1	ชัยชนะ	\N	เกียรติสกุล	1	1	0	0	4	ถนนอุดรดุษฎี	\N	\N	1003	2557	422	2	3.33	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	4-9510-99126-66-1	\N	1	สมศักดิ์	\N	จันทร์แก้ว	1	1	0	0	1	ถนนช้างเผือก	\N	\N	1001	2559	113	2	2.16	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	2-2678-23526-50-6	\N	1	ภัคพล	\N	สุดสวย	1	1	0	0	5	ถนนสรงประภา	\N	\N	1002	2563	105	1	2.46	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	3-8210-56030-37-3	\N	2	ประภา	\N	อ่อนน้อม	2	1	0	0	7	ถ.ประชาสามัคคี	\N	\N	1002	2567	101	3	3.34	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	6-8035-51222-27-4	\N	1	ศุภณัฐ	\N	จันทร์แก้ว	1	1	0	0	5	ถนนบรมราชชนนี	\N	\N	1002	2560	112	3	3.46	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	6-6653-73813-71-1	\N	2	มาลัย	\N	พรประเสริฐ	2	1	0	0	9	ถนนสรงประภา	\N	\N	1003	2559	113	1	3.03	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	4-9482-89551-75-4	\N	1	นพรัตน์	\N	คงพิทักษ์	1	1	0	0	7	ถนนวิภาวดีรังสิต	\N	\N	1003	2564	104	3	3.78	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	2-9655-11581-56-6	\N	1	ปัณณทัต	\N	กิตติคุณ	1	1	0	0	3	ถนนบายพาส	\N	\N	1004	2559	113	1	3	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	1-5295-38277-15-1	\N	2	ทิพย์สุดา	\N	งามดี	2	1	0	0	7	ถนนโชคชัย	\N	\N	1004	2566	102	1	3.38	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	3-5546-20957-49-2	\N	3	สมหญิง	\N	สกุลดี	2	1	0	0	9	ถนนสาทร	\N	\N	1004	2563	105	3	3.07	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	2-6081-67342-40-1	\N	1	ปิยังกูร	\N	วิไลวรรณ	1	1	0	0	4	ถนนบรมราชชนนี	\N	\N	1004	2564	104	3	3.57	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	3-2956-11660-27-1	\N	3	สุภัสสรา	\N	นิ่มนวล	2	1	0	0	3	ถ.บ้านโป่ง	\N	\N	1001	2567	101	3	3.61	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	5-2934-13847-52-7	\N	3	ปิยนุช	\N	เพ็งพา	2	1	0	0	5	ถนนเจริญกรุง	\N	\N	1003	2561	111	3	3.61	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	1-9185-84302-31-6	\N	1	สิรภพ	\N	วังขวา	1	1	0	0	3	ถนนเยาวราช	\N	\N	1001	2566	102	2	3.27	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	1-1201-42053-15-8	\N	1	สุทธิพงษ์	\N	สุจริต	1	1	0	0	6	ถนนบายพาส	\N	\N	1001	2563	105	3	3.02	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	7-4678-52179-41-7	\N	1	ธนาธิป	\N	มงคล	1	1	0	0	6	ถนนกาญจนาภิเษก	\N	\N	1001	2567	103	3	3.53	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	3-4656-77603-15-7	\N	1	สุทธิพงษ์	\N	เกียรติสกุล	1	1	0	0	2	ถ.รัฐพัฒนา	\N	\N	1001	2561	111	3	3.82	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	5-4974-70807-57-8	\N	3	สุดารัตน์	\N	วงษ์สุวรรณ	2	1	0	0	4	ถนนนวมินทร์	\N	\N	1004	2567	101	2	2.8	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	1-6488-10191-94-7	\N	1	อภิวัฒน์	\N	สุขสบาย	1	1	0	0	5	ถนนเพชรเกษม	\N	\N	1004	2567	101	1	3.31	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	3-5584-22193-15-4	\N	1	คุณากร	\N	พงษ์ไพร	1	1	0	0	9	ถนนมาลัยแมน	\N	\N	1004	2567	103	1	3.95	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	7-2226-87580-82-1	\N	2	พรรษา	\N	ชูศรี	2	1	0	0	7	ถนนสรงประภา	\N	\N	1001	2567	103	1	3.35	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	6-6211-69343-44-4	\N	1	ศิวกร	\N	หอมหวาน	1	1	0	0	2	ถนนอ่อนนุช	\N	\N	1003	2567	103	3	3.7	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	8-6145-63282-25-9	\N	1	ชูเกียรติ	\N	สง่างาม	1	1	0	0	6	ถนนสาทร	\N	\N	1001	2567	101	1	2.75	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	5-1660-38183-51-3	\N	3	สุดารัตน์	\N	หอมหวาน	2	1	0	0	2	ถนนสุรวงศ์	\N	\N	1001	2562	106	1	3.62	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	7-8408-82869-80-4	\N	2	จิราพร	\N	สุจริต	2	1	0	0	2	ถ.รัฐพัฒนา	\N	\N	1003	2557	422	1	2.06	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	7-7098-99952-90-2	\N	1	ปรเมศวร์	\N	ศรีสุข	1	1	0	0	10	ถนนเยาวราช	\N	\N	1001	2564	104	1	2.44	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	6-3007-15596-69-1	\N	1	ภูมิพัฒน์	\N	ใจดี	1	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	1002	2562	106	1	2.18	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	3-5505-46681-67-3	\N	2	ศิริพร	\N	เจริญชัย	2	1	0	0	1	ถนนสุรวงศ์	\N	\N	1004	2560	112	2	2.43	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	3-7868-36143-92-9	\N	3	ศิริพร	\N	ศักดิ์สิทธิ์	2	1	0	0	4	ถนนนวมินทร์	\N	\N	1004	2567	103	1	2.7	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	6-9231-52153-59-5	\N	1	วีรชัย	\N	ธนาคาร	1	1	0	0	3	ถนนสุขุมวิท	\N	\N	1003	2557	422	3	3.56	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	4-3615-23124-41-4	\N	2	จิตรลดา	\N	มณีรัตน์	2	1	0	0	5	ถนนนวมินทร์	\N	\N	1003	2563	105	2	3.06	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	6-6878-87537-13-6	\N	1	ทัศนัย	\N	อินทร์ชัย	1	1	0	0	10	ถนนชัยพฤกษ์	\N	\N	1004	2566	102	1	2.76	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	1-4811-88861-38-1	\N	1	วุฒิพงษ์	\N	บุญรอด	1	1	0	0	9	ถ.เอกชัย	\N	\N	1003	2562	106	2	2.08	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	6-1975-12872-28-3	\N	1	ชาตรี	\N	นิ่มนวล	1	1	0	0	2	ถนนเจริญกรุง	\N	\N	1002	2562	106	2	3.43	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	6-3235-30644-65-8	\N	3	ชลธิชา	\N	วังขวา	2	1	0	0	6	ถนนศรีนครินทร์	\N	\N	1004	2566	102	1	3	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	1-7415-84381-14-3	\N	2	พรทิพย์	\N	เจริญชัย	2	1	0	0	10	ถนนห้วยแก้ว	\N	\N	1003	2561	111	1	2.52	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	2-4899-55457-50-3	\N	1	วสันต์	\N	ดำรงค์	1	1	0	0	2	ถนนช้างเผือก	\N	\N	1001	2566	102	1	3	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	2-1020-16310-59-8	\N	3	พิมพ์ชนก	\N	คงมั่น	2	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	1002	2567	103	2	2.66	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	4-3664-69151-19-1	\N	3	ศิริพร	\N	สุวรรณภูมิ	2	1	0	0	5	ถนนสุขุมวิท	\N	\N	1004	2564	104	2	3.62	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	2-9962-22203-53-8	\N	2	ปาณิสรา	\N	ใจดี	2	1	0	0	1	ถนนอุดรดุษฎี	\N	\N	1003	2564	104	2	2.49	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	4-7705-82628-79-5	\N	1	ไกรวุฒิ	\N	สกุลดี	1	1	0	0	5	ถนนนิมมานเหมินท์	\N	\N	1002	2563	105	1	2.66	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	3-1893-57294-10-7	\N	1	ชนะชัย	\N	แสงสว่าง	1	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	1004	2566	102	3	3.76	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	2-8758-25139-49-7	\N	2	กุลธิดา	\N	มณีรัตน์	2	1	0	0	8	ถ.บ้านโป่ง	\N	\N	1002	2567	103	3	2.73	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	1-5313-67637-69-5	\N	3	กัญญาณัฐ	\N	สมบูรณ์	2	1	0	0	4	ถนนกาญจนาภิเษก	\N	\N	1003	2566	102	2	2.78	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	7-4727-82561-17-7	\N	1	อภิวัฒน์	\N	งามดี	1	1	0	0	9	ถนนมาลัยแมน	\N	\N	1001	2560	112	3	2.69	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	1-9226-84870-76-3	\N	2	ดรุณี	\N	ลือชา	2	1	0	0	2	ถ.ประชาสามัคคี	\N	\N	1003	2566	102	2	3.85	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	7-4308-92211-28-5	\N	1	ดิศรณ์	\N	คงมั่น	1	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	1002	2566	102	1	3.14	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	8-1202-91665-85-9	\N	1	วีรชัย	\N	ศักดิ์สิทธิ์	1	1	0	0	7	ถนนรามคำแหง	\N	\N	1004	2560	112	2	3.71	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	5-9775-55071-62-5	\N	2	นันทพร	\N	ดำรงค์	2	1	0	0	7	ถ.บ้านโป่ง	\N	\N	1001	2556	423	3	3.56	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	7-1635-61877-52-4	\N	2	ปัณฑิตา	\N	นามมนตรี	2	1	0	0	1	ถ.เอกชัย	\N	\N	1004	2561	111	3	3.3	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	2-4734-27614-48-8	\N	2	ทิพย์สุดา	\N	ชัยมงคล	2	1	0	0	6	ถนนกาญจนาภิเษก	\N	\N	1003	2560	112	2	3.69	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	6-1920-77537-30-2	\N	2	จิตรลดา	\N	ดีสมัย	2	1	0	0	5	ถนนโชคชัย	\N	\N	1004	2567	103	2	3.53	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	8-1828-57235-35-5	\N	2	อรณิชา	\N	สมบูรณ์	2	1	0	0	6	ถ.รัฐพัฒนา	\N	\N	1002	2562	106	1	2.5	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	8-3909-72204-85-9	\N	2	สมหญิง	\N	สุจริต	2	1	0	0	6	ถนนมิตรภาพ	\N	\N	1001	2559	113	2	2.98	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	3-4511-39012-92-4	\N	1	สิรภพ	\N	ทั่วถึง	1	1	0	0	4	ถนนกาญจนาภิเษก	\N	\N	1001	2558	421	1	2.77	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	1-4666-43081-87-5	\N	2	วาสนา	\N	สง่างาม	2	1	0	0	5	ถนนอุดรดุษฎี	\N	\N	1001	2556	423	1	3.29	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	7-2676-10963-75-6	\N	3	มณีรัตน์	\N	หอมหวาน	2	1	0	0	9	ถนนวิภาวดีรังสิต	\N	\N	1002	2561	111	2	3.42	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	5-5278-95998-93-5	\N	2	แสงดาว	\N	ลือชา	2	1	0	0	4	ถนนชัยพฤกษ์	\N	\N	1001	2559	113	2	3.28	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	1-9148-48745-43-7	\N	1	ณัฐพล	\N	พรสวรรค์	1	1	0	0	7	ถนนบายพาส	\N	\N	1004	2567	101	3	2.71	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010009	6-6991-72056-65-7	\N	1	สุรชัย	\N	ดำรงค์	1	1	0	0	10	ถนนบายพาส	\N	\N	9201	2564	104	2	2.68	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010001	8-6873-76494-48-3	\N	1	มานพ	\N	วังขวา	1	1	0	0	9	ถนนศรีนครินทร์	\N	\N	1002	2567	101	3	3.57	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	6-2463-39131-55-4	\N	3	ภัทรวดี	\N	บุญมี	2	1	0	0	5	ถนนมาลัยแมน	\N	\N	1003	2561	111	1	3.9	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	2-8736-35499-74-2	\N	3	ทิพย์สุดา	\N	ชูศรี	2	1	0	0	7	ถนนเจริญกรุง	\N	\N	1003	2567	101	1	3.21	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	8-3346-51469-33-2	\N	2	สุนิสา	\N	มงคล	2	1	0	0	8	ถนนช้างเผือก	\N	\N	1002	2559	113	1	2.69	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	3-3595-74169-21-3	\N	1	ณัฐวุฒิ	\N	ยิ้มแย้ม	1	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	1001	2567	103	2	2.69	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	6-1230-52233-77-4	\N	3	จิราพร	\N	ลือชา	2	1	0	0	1	ถนนพหลโยธิน	\N	\N	1004	2560	112	1	3.07	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	5-3736-18557-15-5	\N	1	วิชญ์พล	\N	สุดสวย	1	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	1003	2559	113	1	2.21	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	7-1313-39939-38-3	\N	2	อัมพร	\N	ชัยมงคล	2	1	0	0	4	ถนนสุขุมวิท	\N	\N	1004	2567	103	1	2.5	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	1-1785-96765-23-1	\N	1	รัฐนนท์	\N	เกียรติสกุล	1	1	0	0	1	ถนนรามคำแหง	\N	\N	1001	2558	421	3	2.51	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	1-5933-65164-94-2	\N	3	ลลิตา	\N	ศรีสุข	2	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	1003	2564	104	3	2.48	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	5-2867-23928-73-4	\N	1	รชานนท์	\N	สุขสันต์	1	1	0	0	10	ถนนอ่อนนุช	\N	\N	1001	2567	103	3	3.31	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	8-4402-73001-52-4	\N	2	ปิยนุช	\N	สุวรรณภูมิ	2	1	0	0	1	ถนนพหลโยธิน	\N	\N	1004	2558	421	1	2.08	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	2-2659-43540-92-4	\N	1	รัฐนนท์	\N	สุขสันต์	1	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	1004	2566	102	1	3.67	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	6-7979-25191-22-1	\N	2	พรรษา	\N	จันทร์แก้ว	2	1	0	0	1	ถนนสรงประภา	\N	\N	1002	2563	105	2	2.72	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	2-7105-54921-33-2	\N	1	ชาตรี	\N	สุวรรณภูมิ	1	1	0	0	7	ถนนสุดสาคร	\N	\N	1004	2556	423	2	3.76	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	3-2852-27368-99-1	\N	3	อภิญญา	\N	สุดสวย	2	1	0	0	3	ถนนเพชรเกษม	\N	\N	1004	2560	112	3	3.77	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	6-1472-99714-26-8	\N	3	มาลัย	\N	พรสวรรค์	2	1	0	0	8	ถนนรามคำแหง	\N	\N	1004	2566	102	3	3.07	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	4-6542-78039-76-2	\N	2	ลลิตา	\N	ใจดี	2	1	0	0	7	ถนนสุรวงศ์	\N	\N	1003	2561	111	1	3.47	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	8-9123-31679-19-8	\N	3	มณีรัตน์	\N	รักษ์ไทย	2	1	0	0	6	ถนนสุรวงศ์	\N	\N	1001	2559	113	3	3.87	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	4-2291-70174-66-8	\N	2	อภิญญา	\N	วิริยะ	2	1	0	0	2	ถ.บ้านโป่ง	\N	\N	1002	2566	102	3	3.07	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	1-2489-89194-89-5	\N	2	ชนิดา	\N	กิตติคุณ	2	1	0	0	9	ถนนประดิษฐ์มนูธรรม	\N	\N	1001	2566	102	2	3.12	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	4-8445-53512-81-8	\N	1	ชัยชนะ	\N	เพียรดี	1	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	1004	2566	102	2	3.74	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	5-9973-78417-57-2	\N	1	ชนะชัย	\N	งามดี	1	1	0	0	1	ถนนราษฎร์บูรณะ	\N	\N	1002	2558	421	2	2.71	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	7-4532-69905-34-6	\N	3	อรณิชา	\N	จันทร์แก้ว	2	1	0	0	2	ถนนมาลัยแมน	\N	\N	1003	2557	422	1	2.38	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	3-9172-10568-77-1	\N	1	วสันต์	\N	สุขสันต์	1	1	0	0	9	ถนนอุดรดุษฎี	\N	\N	1001	2563	105	2	3.32	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	6-9259-60418-63-4	\N	2	วาสนา	\N	สุดสวย	2	1	0	0	5	ถนนสุดสาคร	\N	\N	1002	2561	111	1	2.9	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	5-9975-51144-80-4	\N	3	วิมลรัตน์	\N	พรสวรรค์	2	1	0	0	4	ถนนสาทร	\N	\N	1002	2563	105	2	3.21	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	6-2890-56168-81-8	\N	3	แสงดาว	\N	สุจริต	2	1	0	0	10	ถนนมาลัยแมน	\N	\N	1002	2562	106	3	3.08	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	1-4275-44993-30-5	\N	2	อัมพร	\N	พรประเสริฐ	2	1	0	0	5	ถนนชัยพฤกษ์	\N	\N	1001	2561	111	2	2.46	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	8-2679-90754-96-9	\N	1	อนุชา	\N	ธนาคาร	1	1	0	0	4	ถนนประดิษฐ์มนูธรรม	\N	\N	1003	2557	422	3	2.06	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	6-1881-11699-42-4	\N	3	นลินทิพย์	\N	สุดสวย	2	1	0	0	10	ถ.ประชาสามัคคี	\N	\N	1001	2557	422	2	2.83	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	4-4170-48558-67-3	\N	1	วสันต์	\N	วังขวา	1	1	0	0	2	ถนนศรีนครินทร์	\N	\N	1003	2562	106	3	3.48	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	5-3131-31093-84-5	\N	1	เอกพงษ์	\N	วิริยะ	1	1	0	0	1	ถนนช้างเผือก	\N	\N	1001	2561	111	1	2.97	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	5-9037-85061-80-6	\N	2	จันทร์เพ็ญ	\N	ทองดี	2	1	0	0	2	ถนนห้วยแก้ว	\N	\N	1002	2560	112	3	2.1	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	7-2506-55796-38-4	\N	1	ธนาธิป	\N	พรประเสริฐ	1	1	0	0	6	ถนนช้างเผือก	\N	\N	1001	2564	104	1	2.95	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	6-8301-41502-92-4	\N	2	วิมลรัตน์	\N	งามดี	2	1	0	0	1	ถนนห้วยแก้ว	\N	\N	1004	2566	102	3	2.51	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	6-9426-76680-67-8	\N	3	สุภัสสรา	\N	หอมหวาน	2	1	0	0	1	ถนนวิภาวดีรังสิต	\N	\N	1003	2564	104	3	3.68	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	1-2072-37627-95-4	\N	1	ณัฐวุฒิ	\N	วิริยะ	1	1	0	0	7	ถนนเพชรเกษม	\N	\N	1001	2567	101	1	3.96	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	1-8523-53478-14-2	\N	1	ปิยังกูร	\N	สุขสันต์	1	1	0	0	2	ถนนรัตนาธิเบศร์	\N	\N	1004	2559	113	3	3.37	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	7-7357-69129-90-7	\N	1	สิรภพ	\N	ศักดิ์สิทธิ์	1	1	0	0	7	ถนนห้วยแก้ว	\N	\N	1001	2567	101	1	3.87	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	2-1745-19514-55-9	\N	1	วีรชัย	\N	สุจริต	1	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	1001	2559	113	1	3.28	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	1-8765-30489-78-4	\N	2	จิตรลดา	\N	พันธุ์ดี	2	1	0	0	3	ถนนสุดสาคร	\N	\N	1004	2564	104	2	3.68	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	3-3019-15475-10-7	\N	2	สมหญิง	\N	ขาวสะอาด	2	1	0	0	9	ถนนประดิษฐ์มนูธรรม	\N	\N	1003	2561	111	3	3.77	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	3-3637-34116-38-5	\N	1	พิพัฒน์	\N	คงมั่น	1	1	0	0	4	ถนนรามคำแหง	\N	\N	1003	2557	422	2	3.81	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	2-5762-98039-18-5	\N	1	บุญยิ่ง	\N	พรสวรรค์	1	1	0	0	2	ถนนอ่อนนุช	\N	\N	1001	2567	101	2	3.47	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	4-6206-73682-67-6	\N	3	เกวลิน	\N	บุญมี	2	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	1002	2559	113	2	3.24	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	6-5033-39035-92-7	\N	1	สุทธิพงษ์	\N	ดำรงค์	1	1	0	0	5	ถนนกลางเมือง	\N	\N	1003	2566	102	2	2.75	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	5-8978-82308-23-3	\N	1	ณัฐวรรธน์	\N	สีดา	1	1	0	0	10	ถนนบรมราชชนนี	\N	\N	1003	2562	106	2	2.89	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	1-7637-87337-37-1	\N	2	อรณิชา	\N	หอมหวาน	2	1	0	0	9	ถนนเยาวราช	\N	\N	1001	2567	101	1	3.77	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	5-3193-70909-74-9	\N	2	นวลจันทร์	\N	เกียรติสกุล	2	1	0	0	2	ถนนสุดสาคร	\N	\N	1004	2562	106	3	3.47	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	3-8310-30869-32-3	\N	2	วาสนา	\N	เพียรดี	2	1	0	0	8	ถนนมิตรภาพ	\N	\N	1002	2564	104	3	2.5	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	4-1701-97632-36-9	\N	1	วิชญ์พล	\N	งามดี	1	1	0	0	6	ถนนบายพาส	\N	\N	1004	2562	106	1	2.53	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	5-5314-85842-79-3	\N	2	พรรษา	\N	ทองดี	2	1	0	0	7	ถนนบายพาส	\N	\N	1003	2563	105	3	3.94	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	6-2938-96652-39-7	\N	2	รัตนาภรณ์	\N	ใจดี	2	1	0	0	6	ถนนรามคำแหง	\N	\N	1003	2564	104	1	2.54	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	7-1367-41938-15-3	\N	3	แสงดาว	\N	ลือชา	2	1	0	0	10	ถนนราษฎร์บูรณะ	\N	\N	1002	2559	113	1	3.29	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	5-3949-77717-61-1	\N	1	วสันต์	\N	วิริยะ	1	1	0	0	5	ถนนบรมราชชนนี	\N	\N	1001	2560	112	1	2.11	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	7-3338-86368-33-9	\N	1	กวินท์	\N	คงพิทักษ์	1	1	0	0	5	ถนนราษฎร์บูรณะ	\N	\N	1004	2558	421	1	2.44	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	4-9564-76107-97-7	\N	2	พรรษา	\N	อินทร์ชัย	2	1	0	0	3	ถนนเพชรเกษม	\N	\N	1004	2564	104	1	2.4	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	2-8901-96427-26-9	\N	1	สุรชัย	\N	นิ่มนวล	1	1	0	0	1	ถนนอุดรดุษฎี	\N	\N	1001	2564	104	3	3.55	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	7-6742-87207-99-2	\N	2	ทิพย์สุดา	\N	สุดสวย	2	1	0	0	7	ถนนสรงประภา	\N	\N	1004	2562	106	2	3.58	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	7-5223-34775-10-1	\N	2	กาญจนา	\N	มงคล	2	1	0	0	10	ถนนเจริญกรุง	\N	\N	1001	2567	103	3	3.78	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	7-6935-23970-29-7	\N	1	คุณากร	\N	สุขสบาย	1	1	0	0	10	ถนนเยาวราช	\N	\N	1004	2566	102	3	3.71	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	7-4337-64162-80-9	\N	3	บุษยา	\N	ดำรงค์	2	1	0	0	8	ถนนศรีนครินทร์	\N	\N	1003	2560	112	2	3.98	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	7-3262-96413-25-4	\N	3	กัญญา	\N	หอมหวาน	2	1	0	0	8	ถนนราษฎร์บูรณะ	\N	\N	1003	2561	111	2	3.59	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	1-3633-61000-91-1	\N	1	นรวิชญ์	\N	วิริยะ	1	1	0	0	2	ถนนชัยพฤกษ์	\N	\N	1004	2558	421	3	3.23	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	1-7296-62513-88-9	\N	3	จิตรลดา	\N	วงษ์สุวรรณ	2	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	1001	2557	422	1	2.74	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	5-4190-14405-86-9	\N	1	วสันต์	\N	กิตติคุณ	1	1	0	0	9	ถนนสีลม	\N	\N	1004	2558	421	1	3.7	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	3-2422-46167-61-6	\N	1	ณัฐวรรธน์	\N	ทองดี	1	1	0	0	7	ถนนสุดสาคร	\N	\N	1003	2561	111	3	2.2	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	6-6693-46242-38-4	\N	1	คุณากร	\N	สุขสบาย	1	1	0	0	8	ถนนสุดสาคร	\N	\N	1001	2567	101	3	2.93	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	5-6570-25336-75-5	\N	1	สิรภพ	\N	สมบูรณ์	1	1	0	0	9	ถนนเยาวราช	\N	\N	1004	2560	112	1	3.12	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	1-8896-25239-43-2	\N	3	นภาพร	\N	สง่างาม	2	1	0	0	7	ถนนสีลม	\N	\N	1002	2567	101	2	3.52	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	5-5067-47655-21-7	\N	1	ณัฐวุฒิ	\N	รุ่งเรือง	1	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	1003	2557	422	3	2.02	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	4-9175-36170-40-4	\N	1	สุรชัย	\N	วิไลวรรณ	1	1	0	0	5	ถนนสาทร	\N	\N	1003	2556	423	3	2.54	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	2-2964-20287-96-8	\N	1	ชินดนัย	\N	สุขสันต์	1	1	0	0	10	ถนนพหลโยธิน	\N	\N	1002	2556	423	2	2.31	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	8-3996-76995-45-7	\N	1	สุรชัย	\N	เกียรติสกุล	1	1	0	0	4	ถนนสรงประภา	\N	\N	1003	2562	106	3	3.74	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	6-7450-99959-32-8	\N	1	คุณากร	\N	พรสวรรค์	1	1	0	0	2	ถนนเจริญกรุง	\N	\N	1004	2564	104	3	2.26	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	6-5254-34530-80-5	\N	2	ชนิดา	\N	สุขสบาย	2	1	0	0	4	ถนนกาญจนาภิเษก	\N	\N	1002	2560	112	3	2.2	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	6-6981-62506-45-8	\N	3	เพ็ญพักตร์	\N	เกียรติสกุล	2	1	0	0	3	ถนนสรงประภา	\N	\N	1002	2559	113	2	2.42	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	7-4212-29116-29-8	\N	1	ชนะชัย	\N	สีดา	1	1	0	0	1	ถนนศรีนครินทร์	\N	\N	1003	2561	111	3	2.98	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	1-7527-22972-98-3	\N	2	ศิริพร	\N	มงคล	2	1	0	0	1	ถนนสาทร	\N	\N	1003	2560	112	2	2.5	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	5-6638-12599-62-2	\N	2	กาญจนา	\N	มีสุข	2	1	0	0	6	ถนนอ่อนนุช	\N	\N	1003	2560	112	2	2.72	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	8-2284-59947-88-5	\N	1	ชูเกียรติ	\N	พันธุ์ดี	1	1	0	0	8	ถนนชัยพฤกษ์	\N	\N	1003	2563	105	3	3.02	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	7-2168-20369-30-6	\N	1	วสันต์	\N	พรสวรรค์	1	1	0	0	4	ถนนห้วยแก้ว	\N	\N	1003	2557	422	3	3.22	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	8-6950-86928-76-8	\N	3	นวลจันทร์	\N	วังขวา	2	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	1003	2566	102	3	3.09	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	2-4450-31877-60-2	\N	1	ภูมิพัฒน์	\N	บุญมี	1	1	0	0	2	ถนนงามวงศ์วาน	\N	\N	1002	2564	104	3	3.46	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	3-2381-95830-59-5	\N	2	กัญญา	\N	มณีรัตน์	2	1	0	0	4	ถนนสุรวงศ์	\N	\N	1004	2559	113	1	2.21	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	6-8801-71235-79-5	\N	2	ลลิตา	\N	บุญมี	2	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	1002	2561	111	1	3.39	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	7-9576-93858-91-9	\N	1	อนุชา	\N	บุญรอด	1	1	0	0	5	ถนนมิตรภาพ	\N	\N	1002	2556	423	3	2.91	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	5-3551-49789-11-1	\N	2	บุษยา	\N	พรสวรรค์	2	1	0	0	9	ถนนสรงประภา	\N	\N	1001	2561	111	2	2.86	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	7-5799-88250-39-1	\N	3	วิมลรัตน์	\N	บุญรอด	2	1	0	0	9	ถนนกลางเมือง	\N	\N	1001	2556	423	2	2.6	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	7-7199-38913-43-2	\N	1	รชานนท์	\N	ศักดิ์สิทธิ์	1	1	0	0	7	ถนนสุรวงศ์	\N	\N	1004	2563	105	1	2.33	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	2-8460-90967-67-5	\N	3	วิมลรัตน์	\N	รุ่งเรือง	2	1	0	0	10	ถ.บ้านโป่ง	\N	\N	1002	2559	113	1	2.27	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	2-5622-45283-26-8	\N	1	ณัฐวุฒิ	\N	มณีรัตน์	1	1	0	0	1	ถนนสีลม	\N	\N	1002	2563	105	3	2.04	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	8-7084-70776-99-1	\N	1	อภิวัฒน์	\N	สุขสบาย	1	1	0	0	6	ถนนบรมราชชนนี	\N	\N	1004	2557	422	2	2.84	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	4-5097-60014-11-2	\N	1	ณัฐพล	\N	นามมนตรี	1	1	0	0	4	ถนนบายพาส	\N	\N	1004	2562	106	3	2.94	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	4-8746-61003-97-5	\N	2	นลินทิพย์	\N	ดีสมัย	2	1	0	0	6	ถนนราษฎร์บูรณะ	\N	\N	1004	2560	112	3	3.33	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	4-6905-16827-95-4	\N	1	เอกพงษ์	\N	ศักดิ์สิทธิ์	1	1	0	0	2	ถนนสุรวงศ์	\N	\N	1001	2559	113	2	3.28	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	4-1146-15504-84-8	\N	2	ชนิดา	\N	เพ็งพา	2	1	0	0	10	ถนนชัยพฤกษ์	\N	\N	1003	2561	111	1	2.91	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	1-1979-56598-92-3	\N	2	กัญญาณัฐ	\N	เพ็งพา	2	1	0	0	9	ถนนเพชรเกษม	\N	\N	1004	2556	423	3	3.24	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	8-4161-12798-98-7	\N	1	วุฒิพงษ์	\N	อินทร์ชัย	1	1	0	0	6	ถนนสรงประภา	\N	\N	1003	2558	421	3	3.51	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	8-4109-84278-33-9	\N	3	ปัณฑิตา	\N	วังขวา	2	1	0	0	6	ถนนห้วยแก้ว	\N	\N	1004	2564	104	2	3.18	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	6-8439-10094-91-9	\N	2	อภิญญา	\N	ใจดี	2	1	0	0	7	ถนนศรีนครินทร์	\N	\N	1002	2562	106	2	3.64	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	2-9830-60789-34-9	\N	1	ทักษิณ	\N	มงคล	1	1	0	0	8	ถนนประดิษฐ์มนูธรรม	\N	\N	1003	2559	113	1	2.64	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	2-9572-96362-18-1	\N	1	ทักษิณ	\N	พันธุ์ดี	1	1	0	0	3	ถนนศรีนครินทร์	\N	\N	1003	2562	106	3	2.64	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	7-9026-78920-89-5	\N	1	ชินดนัย	\N	จันทร์แก้ว	1	1	0	0	1	ถนนกลางเมือง	\N	\N	1004	2560	112	1	2.06	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	2-8668-93744-17-6	\N	1	ไกรวุฒิ	\N	วังขวา	1	1	0	0	9	ถนนมาลัยแมน	\N	\N	1001	2567	103	1	3.38	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	5-2276-38298-76-2	\N	2	จันทร์เพ็ญ	\N	ปัญญาดี	2	1	0	0	2	ถนนสีลม	\N	\N	1003	2558	421	1	3.47	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	7-2728-93705-83-6	\N	2	กุลธิดา	\N	พรประเสริฐ	2	1	0	0	8	ถนนอุดรดุษฎี	\N	\N	1002	2561	111	3	3.91	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	3-9747-88632-66-6	\N	1	ดิศรณ์	\N	ธนาคาร	1	1	0	0	6	ถนนประดิษฐ์มนูธรรม	\N	\N	1002	2559	113	2	3.01	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	4-7145-82120-42-6	\N	3	ทิพย์สุดา	\N	งามดี	2	1	0	0	8	ถ.ประชาสามัคคี	\N	\N	1004	2567	101	3	2.86	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	5-1107-49365-38-4	\N	2	พิมพ์ชนก	\N	พันธุ์ดี	2	1	0	0	6	ถนนสุขุมวิท	\N	\N	1001	2557	422	1	3.99	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	5-7014-86304-41-4	\N	2	กัญญา	\N	จันทร์แก้ว	2	1	0	0	5	ถนนนิมมานเหมินท์	\N	\N	1001	2567	101	2	2.73	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	8-3832-73999-98-2	\N	1	สุทธิพงษ์	\N	ประสิทธิ์ผล	1	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	1002	2559	113	3	2.65	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	6-6700-66925-63-2	\N	1	วรพล	\N	พรสวรรค์	1	1	0	0	4	ถนนพหลโยธิน	\N	\N	1004	2557	422	1	3.84	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	6-9231-38940-29-1	\N	3	วรรณภา	\N	พรประเสริฐ	2	1	0	0	7	ถ.ประชาสามัคคี	\N	\N	1001	2567	103	3	3.22	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	2-8796-84899-16-9	\N	1	วิชญ์พล	\N	สกุลดี	1	1	0	0	7	ถนนเยาวราช	\N	\N	1003	2560	112	1	2.26	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	4-8993-61815-93-4	\N	1	ธัชพล	\N	วิริยะ	1	1	0	0	9	ถนนเจริญกรุง	\N	\N	1004	2567	101	1	3.22	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	2-2843-98047-62-7	\N	1	ปัณณทัต	\N	ใจดี	1	1	0	0	6	ถนนมิตรภาพ	\N	\N	1003	2557	422	2	3.37	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	8-3389-67732-15-4	\N	1	ณัฐวุฒิ	\N	สุวรรณภูมิ	1	1	0	0	4	ถนนกลางเมือง	\N	\N	1001	2564	104	1	3.98	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	3-5713-11800-53-2	\N	1	ทัศนัย	\N	สีดา	1	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	1001	2556	423	3	2.11	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	5-9991-73311-89-3	\N	3	ณัฐนิชา	\N	คงมั่น	2	1	0	0	1	ถนนบายพาส	\N	\N	1002	2567	103	3	3.14	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	5-1869-70943-93-1	\N	1	สิรภพ	\N	เพ็งพา	1	1	0	0	2	ถนนบายพาส	\N	\N	1001	2556	423	1	3.58	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	7-9331-23055-50-8	\N	3	รุ่งอรุณ	\N	จันทร์แก้ว	2	1	0	0	10	ถนนนวมินทร์	\N	\N	1001	2561	111	3	2.9	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	4-9673-49967-52-8	\N	1	ธนาธิป	\N	ดีสมัย	1	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	1004	2561	111	3	2.24	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	5-2015-92023-42-7	\N	1	สมชาย	\N	สุจริต	1	1	0	0	1	ถนนประดิษฐ์มนูธรรม	\N	\N	1003	2567	101	3	2.95	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	4-7837-41504-83-3	\N	2	พรทิพย์	\N	ชัยมงคล	2	1	0	0	7	ถนนนิมมานเหมินท์	\N	\N	1004	2558	421	1	3.46	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	4-3262-50501-98-9	\N	2	ลลิตา	\N	คงมั่น	2	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	1002	2566	102	3	3.53	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	2-4016-51628-28-1	\N	1	ชัยชนะ	\N	ดำรงค์	1	1	0	0	6	ถนนมาลัยแมน	\N	\N	1002	2561	111	1	3.2	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	3-1429-90213-88-5	\N	3	สุดารัตน์	\N	ทั่วถึง	2	1	0	0	10	ถนนสีลม	\N	\N	1003	2562	106	1	2.21	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	8-3196-75840-87-8	\N	1	วิชญ์พล	\N	สุจริต	1	1	0	0	6	ถนนศรีนครินทร์	\N	\N	1001	2557	422	1	3.38	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	1-5421-64138-38-4	\N	3	ศิริพร	\N	บุญมี	2	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	1002	2564	104	1	2.26	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	7-7633-15482-87-7	\N	1	กวินท์	\N	นิ่มนวล	1	1	0	0	6	ถนนสุดสาคร	\N	\N	1004	2556	423	2	3.78	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	4-9498-80499-60-1	\N	1	คุณากร	\N	จันทร์แก้ว	1	1	0	0	9	ถนนบายพาส	\N	\N	1004	2563	105	1	3.76	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	5-8558-31821-64-5	\N	1	ชินดนัย	\N	พันธุ์ดี	1	1	0	0	10	ถนนรัตนาธิเบศร์	\N	\N	1004	2559	113	2	3.55	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	3-9952-27734-60-7	\N	1	เจษฎา	\N	สุขสันต์	1	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	1004	2560	112	3	3	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	3-3024-21952-24-8	\N	1	ธนาธิป	\N	บริบูรณ์	1	1	0	0	6	ถนนบรมราชชนนี	\N	\N	1002	2567	103	1	2.65	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	3-3656-28953-32-1	\N	2	สุมาลี	\N	เจริญชัย	2	1	0	0	7	ถนนนิมมานเหมินท์	\N	\N	1004	2567	101	1	3.87	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	1-5146-11600-68-8	\N	3	สุมาลี	\N	พันธุ์ดี	2	1	0	0	8	ถนนนวมินทร์	\N	\N	1002	2558	421	1	3.92	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	8-7719-67917-20-1	\N	1	ไกรวุฒิ	\N	กิตติคุณ	1	1	0	0	4	ถนนประดิษฐ์มนูธรรม	\N	\N	1002	2562	106	3	3.32	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	1-3381-14250-95-5	\N	2	เพ็ญพักตร์	\N	แสงสว่าง	2	1	0	0	6	ถนนบรมราชชนนี	\N	\N	1002	2566	102	1	3.48	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	3-8460-85886-56-1	\N	1	ชนะชัย	\N	รุ่งเรือง	1	1	0	0	2	ถนนนิมมานเหมินท์	\N	\N	1002	2562	106	3	2.57	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	8-3204-25993-98-5	\N	3	ทิพย์สุดา	\N	ปัญญาดี	2	1	0	0	6	ถนนเจริญกรุง	\N	\N	1001	2567	103	3	2.32	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	2-8924-89269-46-7	\N	2	ปิยนุช	\N	สุดสวย	2	1	0	0	10	ถนนห้วยแก้ว	\N	\N	1002	2558	421	1	2.22	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	8-3947-89876-39-5	\N	3	ปิยนุช	\N	บุญมี	2	1	0	0	4	ถนนพหลโยธิน	\N	\N	1004	2563	105	3	3.26	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	7-1745-53750-54-9	\N	1	ภูมิพัฒน์	\N	บริบูรณ์	1	1	0	0	4	ถนนพหลโยธิน	\N	\N	1001	2557	422	3	4	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	6-1100-24920-97-6	\N	1	อนุชา	\N	พันธุ์ดี	1	1	0	0	6	ถนนสุดสาคร	\N	\N	1003	2567	103	2	2.74	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	8-1582-94626-27-8	\N	1	ธนาธิป	\N	ดีสมัย	1	1	0	0	3	ถ.รัฐพัฒนา	\N	\N	1003	2556	423	3	2.96	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	6-9779-12453-36-6	\N	3	พรรษา	\N	ทั่วถึง	2	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	1001	2558	421	2	3.13	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	3-7382-34560-86-2	\N	1	กันตภณ	\N	สุขสันต์	1	1	0	0	5	ถนนห้วยแก้ว	\N	\N	1001	2563	105	2	3.25	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	5-4541-78825-48-3	\N	1	กันตภณ	\N	รุ่งเรือง	1	1	0	0	2	ถนนกลางเมือง	\N	\N	1001	2560	112	1	2.74	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	8-9192-30195-34-6	\N	1	ชูเกียรติ	\N	ดีสมัย	1	1	0	0	8	ถนนเจริญกรุง	\N	\N	1001	2561	111	3	2.24	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	4-1598-70210-59-9	\N	2	ชนิดา	\N	สง่างาม	2	1	0	0	2	ถนนพหลโยธิน	\N	\N	1001	2560	112	3	3.99	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	5-1368-85701-49-4	\N	2	ปัณฑิตา	\N	ชัยมงคล	2	1	0	0	6	ถนนอ่อนนุช	\N	\N	1004	2559	113	1	3.04	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	3-3580-45866-24-1	\N	1	ศิวกร	\N	นามมนตรี	1	1	0	0	10	ถนนประดิษฐ์มนูธรรม	\N	\N	1003	2566	102	3	2.68	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	5-5011-32449-19-5	\N	1	นรวิชญ์	\N	บุญรอด	1	1	0	0	10	ถนนช้างเผือก	\N	\N	1003	2567	103	2	2.69	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	2-7987-61369-32-8	\N	2	วรรณภา	\N	มณีรัตน์	2	1	0	0	10	ถนนมิตรภาพ	\N	\N	1004	2561	111	1	2.89	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	8-2593-69714-49-8	\N	2	เกวลิน	\N	วังขวา	2	1	0	0	8	ถนนสีลม	\N	\N	1001	2558	421	3	2.26	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	6-6320-69412-72-1	\N	1	อภิวัฒน์	\N	นิ่มนวล	1	1	0	0	2	ถ.เอกชัย	\N	\N	1003	2564	104	2	2.53	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	3-9322-23491-61-2	\N	1	สมชาย	\N	ลือชา	1	1	0	0	6	ถนนประดิษฐ์มนูธรรม	\N	\N	1004	2564	104	2	3.58	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	4-9977-30843-71-7	\N	1	พิพัฒน์	\N	บุญรอด	1	1	0	0	2	ถนนช้างเผือก	\N	\N	1004	2556	423	3	2.83	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	4-3835-96849-95-2	\N	1	อนุชา	\N	ชูศรี	1	1	0	0	10	ถ.บ้านโป่ง	\N	\N	1004	2567	101	3	3.68	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	8-3886-50374-61-2	\N	1	มานพ	\N	คงพิทักษ์	1	1	0	0	10	ถนนเพชรเกษม	\N	\N	1004	2560	112	3	2.2	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	1-3403-96623-29-8	\N	3	ชนิดา	\N	อ่อนน้อม	2	1	0	0	9	ถนนวิภาวดีรังสิต	\N	\N	1001	2566	102	1	3.73	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	5-8122-55123-21-1	\N	3	เพ็ญพักตร์	\N	ดีสมัย	2	1	0	0	10	ถนนโชคชัย	\N	\N	1002	2567	103	2	3.23	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	6-2797-46989-13-4	\N	3	อรณิชา	\N	แสงสว่าง	2	1	0	0	7	ถนนสุดสาคร	\N	\N	1003	2563	105	1	2	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	3-8780-28228-34-9	\N	3	จันทร์เพ็ญ	\N	ประสิทธิ์ผล	2	1	0	0	7	ถนนกลางเมือง	\N	\N	1004	2560	112	3	2.42	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	1-3359-73792-94-7	\N	3	นันทพร	\N	เพียรดี	2	1	0	0	3	ถนนบรมราชชนนี	\N	\N	1002	2556	423	1	2.14	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	7-3945-69558-75-7	\N	1	ชัยชนะ	\N	พรสวรรค์	1	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	1004	2566	102	3	3.41	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	4-9220-45291-62-9	\N	2	มณีรัตน์	\N	สมบูรณ์	2	1	0	0	10	ถนนกลางเมือง	\N	\N	1004	2558	421	1	3.16	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	2-3327-78997-45-8	\N	1	กิตติภณ	\N	ดำรงค์	1	1	0	0	9	ถนนบรมราชชนนี	\N	\N	1004	2556	423	1	3.16	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	1-6628-80127-11-8	\N	1	ปัณณทัต	\N	ลือชา	1	1	0	0	8	ถนนโชคชัย	\N	\N	1001	2561	111	3	2.76	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	5-5267-18050-90-8	\N	3	ดรุณี	\N	รุ่งเรือง	2	1	0	0	10	ถนนราษฎร์บูรณะ	\N	\N	1003	2566	102	2	2.75	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	2-5552-43036-26-5	\N	1	บุญยิ่ง	\N	พันธุ์ดี	1	1	0	0	5	ถนนเยาวราช	\N	\N	1001	2563	105	2	2.17	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	8-7058-32989-43-4	\N	1	เอกพงษ์	\N	ศรีสุข	1	1	0	0	8	ถนนศรีนครินทร์	\N	\N	1002	2557	422	3	2.3	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	7-7277-41188-94-8	\N	1	ชาตรี	\N	วงษ์สุวรรณ	1	1	0	0	3	ถนนสาทร	\N	\N	1002	2564	104	1	3.71	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	8-5937-72425-78-4	\N	3	วรรณภา	\N	งามดี	2	1	0	0	7	ถนนบายพาส	\N	\N	1001	2564	104	1	3.04	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	8-7258-98931-50-9	\N	2	ปาณิสรา	\N	พรประเสริฐ	2	1	0	0	1	ถนนเพชรเกษม	\N	\N	1004	2557	422	2	3.85	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	7-8554-98511-40-4	\N	3	อัมพร	\N	ชัยมงคล	2	1	0	0	9	ถนนช้างเผือก	\N	\N	1003	2567	101	1	2.88	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	2-9605-23619-97-8	\N	1	ณัฐวุฒิ	\N	ศักดิ์สิทธิ์	1	1	0	0	6	ถนนสีลม	\N	\N	1001	2563	105	1	2.02	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	4-2995-25725-21-3	\N	2	ปาณิสรา	\N	ทองดี	2	1	0	0	7	ถนนศรีนครินทร์	\N	\N	1001	2556	423	1	2.11	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	2-8429-46226-64-6	\N	1	อนุชา	\N	สมบูรณ์	1	1	0	0	5	ถนนราษฎร์บูรณะ	\N	\N	1003	2559	113	2	3.32	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	1-5230-44690-32-8	\N	1	กันตภณ	\N	สง่างาม	1	1	0	0	2	ถ.บ้านโป่ง	\N	\N	1001	2567	103	2	2.8	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	7-4578-90473-92-2	\N	1	ทักษิณ	\N	ประสิทธิ์ผล	1	1	0	0	8	ถนนเยาวราช	\N	\N	1002	2556	423	1	2.29	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	8-1307-75234-29-1	\N	1	กิตติภณ	\N	ใจดี	1	1	0	0	1	ถนนบายพาส	\N	\N	1001	2556	423	3	2.5	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	8-8833-67154-61-2	\N	3	นันทพร	\N	ประสิทธิ์ผล	2	1	0	0	9	ถนนสีลม	\N	\N	1001	2567	101	3	3.91	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010009	2-3233-15662-39-5	\N	1	สมชาย	\N	ดีสมัย	1	1	0	0	6	ถ.เอกชัย	\N	\N	9204	2564	104	1	2.38	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010001	6-6463-99369-48-7	\N	1	วีรชัย	\N	สุดสวย	1	1	0	0	1	ถนนบรมราชชนนี	\N	\N	1004	2567	103	3	3.16	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	1-7294-96603-34-5	\N	3	บุษยา	\N	วงษ์สุวรรณ	2	1	0	0	7	ถนนเพชรเกษม	\N	\N	1004	2560	112	3	2.41	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	1-4907-74124-59-2	\N	2	ศิริพร	\N	ยิ้มแย้ม	2	1	0	0	9	ถนนนิมมานเหมินท์	\N	\N	1004	2562	106	1	2.07	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	1-7643-25491-37-9	\N	3	บุษยา	\N	มณีรัตน์	2	1	0	0	8	ถนนนวมินทร์	\N	\N	1001	2563	105	1	2.68	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	8-1312-71763-89-1	\N	1	เอกพงษ์	\N	ชูศรี	1	1	0	0	4	ถนนสรงประภา	\N	\N	1002	2558	421	1	3.47	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	3-2047-23937-24-8	\N	1	ธนาธิป	\N	ยิ้มแย้ม	1	1	0	0	10	ถนนสีลม	\N	\N	1001	2563	105	1	2.91	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	3-6268-37948-15-3	\N	1	ชินดนัย	\N	สกุลดี	1	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	1003	2561	111	2	2.42	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	3-8187-41934-84-1	\N	1	กันตภณ	\N	รักษ์ไทย	1	1	0	0	3	ถนนเพชรเกษม	\N	\N	1004	2561	111	3	2.87	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	2-5648-64555-98-8	\N	2	รัตนาภรณ์	\N	กิตติคุณ	2	1	0	0	3	ถนนสาทร	\N	\N	1001	2563	105	1	2.36	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	1-3949-75521-88-2	\N	1	วสันต์	\N	นามมนตรี	1	1	0	0	5	ถนนมิตรภาพ	\N	\N	1004	2566	102	1	3.91	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	4-8605-92111-94-4	\N	2	พิมพ์ชนก	\N	ดีสมัย	2	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	1001	2564	104	1	3.31	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	1-1885-94523-56-5	\N	1	รัฐนนท์	\N	ธนาคาร	1	1	0	0	4	ถนนอุดรดุษฎี	\N	\N	1002	2557	422	2	2.35	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	1-8947-77489-24-2	\N	3	เกวลิน	\N	ทองดี	2	1	0	0	4	ถ.ประชาสามัคคี	\N	\N	1001	2560	112	3	2.35	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	2-4884-64079-35-7	\N	2	สุนิสา	\N	ทั่วถึง	2	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	1003	2566	102	1	2.99	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	8-3917-60768-57-3	\N	3	มาลัย	\N	แสงสว่าง	2	1	0	0	8	ถนนอ่อนนุช	\N	\N	1004	2557	422	1	3.86	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	5-3236-24563-69-8	\N	2	อภิญญา	\N	ชัยมงคล	2	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	1002	2562	106	3	3.14	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	5	10010001	4-2416-63961-76-8	\N	3	พรทิพย์	\N	คงพิทักษ์	2	1	0	0	4	ถ.เอกชัย	\N	\N	1002	2564	104	1	3.24	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	4-3440-85196-10-7	\N	2	อภิญญา	\N	สีดา	2	1	0	0	1	ถนนลาดพร้าว	\N	\N	1004	2558	421	1	2.65	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	8-9114-41524-20-9	\N	2	สุมาลี	\N	สกุลดี	2	1	0	0	1	ถนนมาลัยแมน	\N	\N	1004	2559	113	3	3.64	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	2	10010001	1-8860-97691-49-3	\N	1	ปรเมศวร์	\N	สุวรรณภูมิ	1	1	0	0	8	ถนนสุขุมวิท	\N	\N	1003	2566	102	3	4	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	1-2158-60446-98-6	\N	2	พรรษา	\N	วังขวา	2	1	0	0	9	ถนนลาดพร้าว	\N	\N	1004	2564	104	2	3.33	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	1-9433-98428-56-1	\N	3	อัมพร	\N	สุดสวย	2	1	0	0	2	ถนนบายพาส	\N	\N	1002	2566	102	3	3.82	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	2-4354-28141-52-4	\N	2	พรรษา	\N	เกียรติสกุล	2	1	0	0	9	ถนนรามคำแหง	\N	\N	1003	2567	103	3	3.21	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	7-5540-17138-18-6	\N	2	วันวิสา	\N	งามดี	2	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	1002	2567	101	2	3.85	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	4	10010001	2-4085-70014-21-2	\N	2	วาสนา	\N	ลือชา	2	1	0	0	7	ถนนศรีนครินทร์	\N	\N	1003	2557	422	3	2.74	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	3-4346-78247-90-1	\N	2	ชลธิชา	\N	เพ็งพา	2	1	0	0	5	ถนนมาลัยแมน	\N	\N	1003	2563	105	3	2.3	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	5-4097-18250-12-4	\N	1	สุรชัย	\N	สุวรรณภูมิ	1	1	0	0	9	ถนนช้างเผือก	\N	\N	1004	2561	111	3	3.36	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	8-8503-49856-82-3	\N	3	มาลัย	\N	อ่อนน้อม	2	1	0	0	5	ถนนราษฎร์บูรณะ	\N	\N	1003	2567	103	3	3.4	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	8-3725-91085-30-9	\N	3	พรทิพย์	\N	เกียรติสกุล	2	1	0	0	5	ถนนศรีนครินทร์	\N	\N	1003	2560	112	1	2.71	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	6-3072-67788-43-6	\N	1	สมศักดิ์	\N	สุดสวย	1	1	0	0	3	ถนนสาทร	\N	\N	1002	2559	113	1	2.23	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	3-9743-49526-25-1	\N	1	บุญยิ่ง	\N	วิไลวรรณ	1	1	0	0	7	ถ.บ้านโป่ง	\N	\N	1003	2561	111	2	3.01	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	1	10010001	6-5842-72116-47-3	\N	1	เจษฎา	\N	วิไลวรรณ	1	1	0	0	10	ถ.ประชาสามัคคี	\N	\N	1002	2564	104	3	3.18	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	2-6047-13250-61-4	\N	2	ดวงใจ	\N	สีดา	2	1	0	0	8	ถนนมิตรภาพ	\N	\N	1004	2558	421	1	3.36	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	5-4206-12955-20-9	\N	1	ณัฐวุฒิ	\N	แสงสว่าง	1	1	0	0	8	ถนนบรมราชชนนี	\N	\N	1002	2558	421	3	2.44	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	7-7056-60608-57-1	\N	3	กุลธิดา	\N	วิไลวรรณ	2	1	0	0	5	ถนนมิตรภาพ	\N	\N	1001	2563	105	2	2.3	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	7-8249-47831-30-7	\N	3	สุดารัตน์	\N	ศักดิ์สิทธิ์	2	1	0	0	7	ถนนสรงประภา	\N	\N	1001	2563	105	3	3.78	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	2-7156-21593-10-7	\N	1	อภิวัฒน์	\N	คงมั่น	1	1	0	0	5	ถนนมาลัยแมน	\N	\N	1003	2564	104	3	3.98	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	5-9037-15535-48-5	\N	1	นพรัตน์	\N	บริบูรณ์	1	1	0	0	8	ถนนประดิษฐ์มนูธรรม	\N	\N	1002	2566	102	1	3.75	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	8-3034-95696-95-5	\N	2	พรทิพย์	\N	ธนาคาร	2	1	0	0	7	ถนนศรีนครินทร์	\N	\N	1001	2561	111	2	2.74	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	2-6927-86161-71-7	\N	2	ดวงใจ	\N	มณีรัตน์	2	1	0	0	5	ถ.เอกชัย	\N	\N	1001	2557	422	2	3.99	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	3-6237-70429-98-3	\N	1	ประพันธ์	\N	วิริยะ	1	1	0	0	6	ถนนราษฎร์บูรณะ	\N	\N	1001	2566	102	1	3.37	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	3	10010001	2-9419-35403-90-3	\N	1	กันตภณ	\N	เกียรติสกุล	1	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	1004	2566	102	1	2.93	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	1	10010001	3-1211-27950-76-5	\N	3	ชนิดา	\N	นามมนตรี	2	1	0	0	6	ถ.บ้านโป่ง	\N	\N	1003	2563	105	3	3.16	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	4-9612-79742-80-2	\N	2	เกวลิน	\N	จันทร์แก้ว	2	1	0	0	7	ถ.รัฐพัฒนา	\N	\N	1002	2557	422	3	2.44	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	6-3277-67925-86-9	\N	1	รัฐนนท์	\N	ปัญญาดี	1	1	0	0	6	ถนนศรีนครินทร์	\N	\N	1002	2561	111	2	2.83	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	3-4438-27067-20-7	\N	2	ณัฐนิชา	\N	อินทร์ชัย	2	1	0	0	2	ถนนงามวงศ์วาน	\N	\N	1002	2556	423	3	2.45	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	1-8685-25587-42-1	\N	1	ชูเกียรติ	\N	ลือชา	1	1	0	0	2	ถนนนิมมานเหมินท์	\N	\N	1004	2559	113	1	2.22	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	4-4027-97896-54-1	\N	1	ทัศนัย	\N	จันทร์แก้ว	1	1	0	0	2	ถนนชัยพฤกษ์	\N	\N	1001	2561	111	1	3.26	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	2-2623-85777-11-9	\N	3	มาลัย	\N	สุวรรณภูมิ	2	1	0	0	4	ถนนอ่อนนุช	\N	\N	1002	2562	106	3	3.23	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010001	8-7004-87251-33-8	\N	2	รัตนาภรณ์	\N	สีดา	2	1	0	0	2	ถนนศรีนครินทร์	\N	\N	1001	2556	423	3	3.7	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	6-3025-71066-24-9	\N	3	นภาพร	\N	คงมั่น	2	1	0	0	3	ถ.บ้านโป่ง	\N	\N	1002	2566	102	1	3.64	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	7-5646-69892-86-5	\N	3	จันทร์เพ็ญ	\N	ศักดิ์สิทธิ์	2	1	0	0	8	ถนนสีลม	\N	\N	1001	2559	113	2	2.99	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	1-9055-98092-23-7	\N	3	วิมลรัตน์	\N	ดีสมัย	2	1	0	0	8	ถนนเจริญกรุง	\N	\N	1001	2561	111	3	2.86	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	2-3764-18481-56-4	\N	1	รัฐนนท์	\N	รักษ์ไทย	1	1	0	0	6	ถนนอ่อนนุช	\N	\N	1004	2556	423	3	3.18	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	5-7557-56674-70-7	\N	2	สุภัสสรา	\N	สุขสันต์	2	1	0	0	8	ถนนโชคชัย	\N	\N	1004	2564	104	2	3.58	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	3-1486-23055-16-2	\N	3	นันทพร	\N	จันทร์แก้ว	2	1	0	0	8	ถนนสุขุมวิท	\N	\N	1001	2556	423	2	2.99	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	2-2253-96649-76-8	\N	1	วีรชัย	\N	คงพิทักษ์	1	1	0	0	8	ถนนอ่อนนุช	\N	\N	1003	2564	104	2	3.32	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	5	10010001	1-1517-66414-25-7	\N	3	รุ่งอรุณ	\N	กิตติคุณ	2	1	0	0	8	ถนนห้วยแก้ว	\N	\N	1003	2563	105	2	3.62	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	5-3689-74419-65-3	\N	3	ลลิตา	\N	ทองดี	2	1	0	0	5	ถนนบายพาส	\N	\N	1001	2567	101	3	3.49	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	5	10010001	8-8797-83695-30-9	\N	2	ประภา	\N	ดำรงค์	2	1	0	0	1	ถนนสุดสาคร	\N	\N	1004	2567	103	3	3.17	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	1-3100-58026-54-1	\N	3	ศิริพร	\N	นิ่มนวล	2	1	0	0	6	ถนนบายพาส	\N	\N	1003	2559	113	2	2.12	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	4-5056-40752-92-5	\N	1	ภัคพล	\N	สุวรรณภูมิ	1	1	0	0	10	ถนนบรมราชชนนี	\N	\N	1003	2564	104	2	2.3	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	1-8551-96214-64-9	\N	1	พิพัฒน์	\N	ศรีสุข	1	1	0	0	7	ถนนกาญจนาภิเษก	\N	\N	1003	2567	101	1	3.31	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	3	10010001	6-2601-74010-22-4	\N	1	อนุชา	\N	ลือชา	1	1	0	0	6	ถ.บ้านโป่ง	\N	\N	1001	2563	105	2	3.14	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	2	10010001	2-9779-38059-46-5	\N	3	รัตนาภรณ์	\N	เกียรติสกุล	2	1	0	0	1	ถนนนิมมานเหมินท์	\N	\N	1004	2557	422	2	3.27	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	5	10010001	8-7997-37490-54-2	\N	2	พรทิพย์	\N	วังขวา	2	1	0	0	5	ถนนโชคชัย	\N	\N	1001	2563	105	2	2.55	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	4	10010001	8-9971-33671-12-9	\N	3	อัมพร	\N	ดีสมัย	2	1	0	0	3	ถ.บ้านโป่ง	\N	\N	1004	2562	106	2	3.25	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	3	10010001	7-1981-78454-35-6	\N	1	บุญยิ่ง	\N	ปัญญาดี	1	1	0	0	8	ถนนชัยพฤกษ์	\N	\N	1004	2556	423	3	3.07	10	กรุงเทพมหานคร	พระนคร	สำราญราษฎร์
2569	1	4	10010001	2-4335-64059-44-5	\N	1	อภิวัฒน์	\N	ทั่วถึง	1	1	0	0	3	ถนนเยาวราช	\N	\N	1003	2561	111	2	2.77	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	5-8604-73620-81-7	\N	1	ธัชพล	\N	พงษ์ไพร	1	1	0	0	7	ถนนลาดพร้าว	\N	\N	1001	2562	106	1	2.06	10	กรุงเทพมหานคร	พระนคร	พระบรมมหาราชวัง
2569	1	1	10010001	5-3883-94448-15-8	\N	1	ดิศรณ์	\N	นามมนตรี	1	1	0	0	1	ถนนรัตนาธิเบศร์	\N	\N	1002	2559	113	2	3.58	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	1	10010001	2-7502-28423-40-2	\N	1	ณัฐวุฒิ	\N	คงพิทักษ์	1	1	0	0	10	ถนนโชคชัย	\N	\N	1003	2560	112	2	3.79	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	4	10010001	2-6134-53160-84-7	\N	1	คุณากร	\N	เพียรดี	1	1	0	0	4	ถนนอุดรดุษฎี	\N	\N	1003	2567	101	1	2.86	10	กรุงเทพมหานคร	พระนคร	วัดราชบพิธ
2569	1	2	10010001	5-1916-74272-78-6	\N	1	อภิวัฒน์	\N	จันทร์แก้ว	1	1	0	0	2	ถนนห้วยแก้ว	\N	\N	1002	2558	421	2	2.88	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	3	10010001	5-1345-94593-87-1	\N	2	กาญจนา	\N	นามมนตรี	2	1	0	0	1	ถนนสุรวงศ์	\N	\N	1002	2564	104	2	3.49	10	กรุงเทพมหานคร	พระนคร	วังบูรพาภิรมย์
2569	1	2	10010002	8-3427-72126-64-1	\N	1	ภัคพล	\N	สุขสันต์	1	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	5005	2566	102	1	2.95	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	8-4975-36389-47-7	\N	1	เอกพงษ์	\N	สุดสวย	1	1	0	0	1	ถนนช้างเผือก	\N	\N	5004	2557	422	2	2.04	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	5-1606-73897-61-8	\N	1	ชนะชัย	\N	ยิ้มแย้ม	1	1	0	0	9	ถ.บ้านโป่ง	\N	\N	5004	2556	423	2	3.47	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	2-5388-94974-63-8	\N	1	สมศักดิ์	\N	แสงสว่าง	1	1	0	0	2	ถ.บ้านโป่ง	\N	\N	5005	2559	113	2	3.15	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	6-8178-40422-74-4	\N	3	ลลิตา	\N	มณีรัตน์	2	1	0	0	10	ถนนช้างเผือก	\N	\N	5002	2564	104	3	2.55	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	6-8738-31237-89-4	\N	3	อรณิชา	\N	สีดา	2	1	0	0	5	ถนนบรมราชชนนี	\N	\N	5004	2559	113	3	3.31	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	5	10010002	7-9089-49800-40-4	\N	2	อรณิชา	\N	ดีสมัย	2	1	0	0	9	ถนนรัตนาธิเบศร์	\N	\N	5002	2564	104	2	2.38	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	1-2043-54267-65-2	\N	1	สมชาย	\N	หอมหวาน	1	1	0	0	10	ถนนสีลม	\N	\N	5003	2563	105	1	3.66	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	3	10010002	1-5382-29815-98-9	\N	1	นพรัตน์	\N	อินทร์ชัย	1	1	0	0	10	ถนนเพชรเกษม	\N	\N	5004	2567	101	2	3.68	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	2-1687-76493-23-3	\N	1	กวินท์	\N	พรสวรรค์	1	1	0	0	2	ถนนสาทร	\N	\N	5004	2567	101	1	3.67	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	5	10010002	2-3527-94815-56-6	\N	3	รัตนาภรณ์	\N	วังขวา	2	1	0	0	3	ถนนรามคำแหง	\N	\N	5004	2558	421	2	3.47	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	3-2396-44867-57-7	\N	1	กวินท์	\N	รุ่งเรือง	1	1	0	0	6	ถนนสุรวงศ์	\N	\N	5001	2560	112	2	2.68	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	7-7773-63648-68-9	\N	1	ทัศนัย	\N	งามดี	1	1	0	0	6	ถนนสุขุมวิท	\N	\N	5005	2567	101	1	2.71	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	1	10010002	7-3692-66894-17-7	\N	2	นันทพร	\N	วังขวา	2	1	0	0	1	ถนนชัยพฤกษ์	\N	\N	5005	2561	111	1	2.81	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	5-6139-55109-11-5	\N	1	วสันต์	\N	วังขวา	1	1	0	0	9	ถนนชัยพฤกษ์	\N	\N	5005	2559	113	2	2.8	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	5	10010002	6-7627-35859-48-2	\N	2	ลลิตา	\N	บุญรอด	2	1	0	0	1	ถนนนวมินทร์	\N	\N	5005	2556	423	3	2.88	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	5-9541-54657-91-3	\N	2	นภาพร	\N	พรประเสริฐ	2	1	0	0	1	ถนนสุขุมวิท	\N	\N	5005	2560	112	1	2.19	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	5	10010002	6-5255-92180-74-6	\N	3	นลินทิพย์	\N	สีดา	2	1	0	0	2	ถนนรัตนาธิเบศร์	\N	\N	5004	2563	105	1	3.46	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	4-6919-69547-22-3	\N	1	สมศักดิ์	\N	เจริญชัย	1	1	0	0	7	ถนนมาลัยแมน	\N	\N	5005	2556	423	1	2.66	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	2-7050-98712-77-7	\N	1	ศุภณัฐ	\N	แสงสว่าง	1	1	0	0	10	ถนนประดิษฐ์มนูธรรม	\N	\N	5004	2559	113	2	2.43	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	8-7830-31344-28-9	\N	3	ปาณิสรา	\N	ยิ้มแย้ม	2	1	0	0	3	ถ.บ้านโป่ง	\N	\N	5004	2563	105	3	3.86	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	3-7051-25566-87-7	\N	2	อรณิชา	\N	สุดสวย	2	1	0	0	2	ถนนรามคำแหง	\N	\N	5002	2561	111	2	2.26	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	6-5968-48532-72-1	\N	3	ดรุณี	\N	ทองดี	2	1	0	0	3	ถนนชัยพฤกษ์	\N	\N	5005	2567	103	1	2.87	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	2-9970-55698-18-1	\N	3	วรรณภา	\N	พันธุ์ดี	2	1	0	0	7	ถ.เอกชัย	\N	\N	5002	2566	102	3	3.23	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	3-3269-76160-91-8	\N	3	ดรุณี	\N	ชัยมงคล	2	1	0	0	8	ถ.ประชาสามัคคี	\N	\N	5004	2564	104	3	3.7	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	5	10010002	7-4814-61825-53-9	\N	1	วรพล	\N	วิไลวรรณ	1	1	0	0	1	ถ.ประชาสามัคคี	\N	\N	5001	2567	101	3	3.44	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	5	10010002	5-3028-94399-81-2	\N	2	นวลจันทร์	\N	เพ็งพา	2	1	0	0	4	ถนนนวมินทร์	\N	\N	5001	2567	101	3	3.69	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	2-9713-33559-12-5	\N	1	สุทธิพงษ์	\N	พรประเสริฐ	1	1	0	0	4	ถนนสุรวงศ์	\N	\N	5002	2563	105	3	3.79	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	1-6569-67280-33-7	\N	3	กัญญาณัฐ	\N	ประสิทธิ์ผล	2	1	0	0	1	ถนนเจริญกรุง	\N	\N	5005	2564	104	2	3.75	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	1	10010002	3-3992-43496-21-3	\N	3	นภาพร	\N	วงษ์สุวรรณ	2	1	0	0	5	ถนนมาลัยแมน	\N	\N	5001	2564	104	3	2.5	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	5-7388-22942-50-3	\N	1	ณัฐพล	\N	นิ่มนวล	1	1	0	0	7	ถนนห้วยแก้ว	\N	\N	5003	2567	101	1	3.57	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	8-9333-76115-59-2	\N	2	นภาพร	\N	แสงสว่าง	2	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	5002	2567	103	3	3.25	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	1-5409-82623-85-2	\N	3	พรรษา	\N	ใจดี	2	1	0	0	4	ถนนประดิษฐ์มนูธรรม	\N	\N	5004	2558	421	2	3.27	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	4-3332-58929-79-3	\N	1	พิพัฒน์	\N	ดำรงค์	1	1	0	0	4	ถนนนวมินทร์	\N	\N	5004	2567	103	1	3.72	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	3-1008-17887-71-5	\N	3	กัญญา	\N	ทองดี	2	1	0	0	10	ถนนเยาวราช	\N	\N	5001	2567	101	3	2.93	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	2-5925-21759-60-2	\N	2	มณีรัตน์	\N	ชูศรี	2	1	0	0	3	ถนนประดิษฐ์มนูธรรม	\N	\N	5005	2562	106	1	2.32	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	5-8417-45784-41-6	\N	2	อัมพร	\N	นิ่มนวล	2	1	0	0	6	ถนนสาทร	\N	\N	5005	2559	113	3	3.89	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	1	10010002	1-3843-64154-81-8	\N	3	จิตรลดา	\N	มณีรัตน์	2	1	0	0	7	ถนนนวมินทร์	\N	\N	5002	2566	102	3	3.21	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	8-3022-56267-58-6	\N	1	ชัยชนะ	\N	อ่อนน้อม	1	1	0	0	7	ถนนศรีนครินทร์	\N	\N	5001	2567	103	1	3.81	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	1-5606-99201-55-4	\N	1	รัฐนนท์	\N	บริบูรณ์	1	1	0	0	2	ถนนนิมมานเหมินท์	\N	\N	5003	2566	102	2	2.51	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	4-1116-35701-91-7	\N	1	วิชญ์พล	\N	กิตติคุณ	1	1	0	0	2	ถนนกาญจนาภิเษก	\N	\N	5003	2566	102	2	3.24	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	3-2065-26702-43-4	\N	2	รัตนาภรณ์	\N	เพียรดี	2	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	5005	2560	112	3	2.35	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	5	10010002	8-1032-65982-92-1	\N	1	ณัฐวรรธน์	\N	มณีรัตน์	1	1	0	0	6	ถนนอุดรดุษฎี	\N	\N	5005	2567	101	2	3.52	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	1-4678-16155-45-7	\N	2	อภิญญา	\N	สุจริต	2	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	5005	2564	104	2	2.85	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	1	10010002	4-7943-19757-41-4	\N	3	พิมพ์ชนก	\N	ดีสมัย	2	1	0	0	3	ถนนช้างเผือก	\N	\N	5003	2564	104	3	3.65	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	6-5102-42394-23-8	\N	2	ชลธิชา	\N	มณีรัตน์	2	1	0	0	4	ถนนช้างเผือก	\N	\N	5004	2562	106	1	3.19	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	2-8314-85882-25-2	\N	1	ชาตรี	\N	พรประเสริฐ	1	1	0	0	1	ถนนลาดพร้าว	\N	\N	5002	2557	422	3	3.24	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	7-2077-23346-96-1	\N	2	ชนิดา	\N	ธนาคาร	2	1	0	0	9	ถนนรัตนาธิเบศร์	\N	\N	5002	2558	421	2	2.11	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	1-8428-60321-69-7	\N	3	นภาพร	\N	จันทร์แก้ว	2	1	0	0	10	ถนนเพชรเกษม	\N	\N	5005	2563	105	1	3.73	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	2-1201-88010-18-4	\N	2	นวลจันทร์	\N	บริบูรณ์	2	1	0	0	10	ถนนสรงประภา	\N	\N	5005	2564	104	3	2.55	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	1-1991-26735-49-7	\N	3	มณีรัตน์	\N	ลือชา	2	1	0	0	9	ถนนมิตรภาพ	\N	\N	5005	2556	423	1	2.49	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	6-1132-77853-85-3	\N	2	มาลัย	\N	รักษ์ไทย	2	1	0	0	1	ถนนสุรวงศ์	\N	\N	5004	2564	104	3	2.82	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	2-6595-34819-95-8	\N	1	ภัคพล	\N	สุวรรณภูมิ	1	1	0	0	8	ถนนช้างเผือก	\N	\N	5002	2567	103	3	3.84	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	1-9125-38757-10-4	\N	3	เพ็ญพักตร์	\N	รุ่งเรือง	2	1	0	0	4	ถ.รัฐพัฒนา	\N	\N	5003	2567	101	1	3.18	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	1-6944-11296-19-6	\N	1	ปัณณทัต	\N	ลือชา	1	1	0	0	1	ถนนประดิษฐ์มนูธรรม	\N	\N	5003	2567	103	1	2.92	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	6-1719-13890-35-4	\N	1	อภิวัฒน์	\N	พันธุ์ดี	1	1	0	0	5	ถนนศรีนครินทร์	\N	\N	5004	2556	423	3	3.17	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	3	10010002	4-1352-33078-43-2	\N	1	สิรภพ	\N	สีดา	1	1	0	0	1	ถนนสรงประภา	\N	\N	5002	2567	103	3	2.64	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	3	10010002	6-3807-79065-89-7	\N	2	นวลจันทร์	\N	ชัยมงคล	2	1	0	0	2	ถนนรามคำแหง	\N	\N	5002	2566	102	2	2.86	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	6-6209-88584-64-4	\N	1	ปรเมศวร์	\N	ธนาคาร	1	1	0	0	1	ถนนอ่อนนุช	\N	\N	5002	2563	105	3	2.76	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	3	10010002	8-4428-20670-70-2	\N	3	นันทพร	\N	พงษ์ไพร	2	1	0	0	3	ถนนโชคชัย	\N	\N	5001	2557	422	1	3.7	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	6-9609-73346-73-8	\N	3	ประภา	\N	กิตติคุณ	2	1	0	0	5	ถนนสุดสาคร	\N	\N	5005	2559	113	1	2.64	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	5-7963-59425-83-3	\N	1	นรวิชญ์	\N	อินทร์ชัย	1	1	0	0	6	ถนนเยาวราช	\N	\N	5002	2557	422	1	2.79	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	3	10010002	4-1674-70981-75-6	\N	1	ปรเมศวร์	\N	งามดี	1	1	0	0	7	ถ.ประชาสามัคคี	\N	\N	5001	2562	106	2	3.04	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	3-8236-40643-43-2	\N	3	อัมพร	\N	เกียรติสกุล	2	1	0	0	6	ถนนบรมราชชนนี	\N	\N	5004	2566	102	2	3.07	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	6-1627-81568-35-6	\N	2	วาสนา	\N	ธนาคาร	2	1	0	0	4	ถนนช้างเผือก	\N	\N	5003	2567	103	1	2.41	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	5-1139-49252-46-6	\N	3	สุดารัตน์	\N	ดีสมัย	2	1	0	0	7	ถนนสุดสาคร	\N	\N	5005	2567	101	3	3.61	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	4-8773-40634-76-9	\N	1	สุรชัย	\N	อ่อนน้อม	1	1	0	0	8	ถ.รัฐพัฒนา	\N	\N	5005	2559	113	2	2.46	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	8-8372-83196-13-6	\N	3	กัญญาณัฐ	\N	มงคล	2	1	0	0	3	ถนนสรงประภา	\N	\N	5002	2557	422	3	2.84	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	3	10010002	7-9808-49274-51-1	\N	2	วันวิสา	\N	กิตติคุณ	2	1	0	0	10	ถนนลาดพร้าว	\N	\N	5003	2558	421	1	2.84	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	7-7247-36765-60-2	\N	1	อภิวัฒน์	\N	ชัยมงคล	1	1	0	0	9	ถนนบายพาส	\N	\N	5005	2558	421	3	3.15	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	5	10010002	5-2527-32468-23-9	\N	1	สุรชัย	\N	จันทร์แก้ว	1	1	0	0	3	ถนนลาดพร้าว	\N	\N	5003	2558	421	2	3.28	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	5-9591-19172-68-1	\N	2	ณัฐนิชา	\N	ดีสมัย	2	1	0	0	6	ถนนเจริญกรุง	\N	\N	5001	2567	101	2	2.81	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	3-9789-64842-71-2	\N	1	ดิศรณ์	\N	วิไลวรรณ	1	1	0	0	7	ถนนสาทร	\N	\N	5004	2559	113	1	3.98	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	5-4325-75860-97-8	\N	1	นรวิชญ์	\N	ขาวสะอาด	1	1	0	0	5	ถนนอ่อนนุช	\N	\N	5004	2558	421	1	3.21	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	6-9043-70319-69-1	\N	1	อภิวัฒน์	\N	มีสุข	1	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	5001	2557	422	3	3.62	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	7-8501-60418-94-3	\N	3	มณีรัตน์	\N	ประสิทธิ์ผล	2	1	0	0	10	ถนนเพชรเกษม	\N	\N	5005	2557	422	2	2.5	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	2-4559-74682-62-9	\N	2	ดวงใจ	\N	พงษ์ไพร	2	1	0	0	2	ถนนกลางเมือง	\N	\N	5002	2557	422	3	3.08	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	3	10010002	5-4397-76330-15-8	\N	1	ทัศนัย	\N	จันทร์แก้ว	1	1	0	0	1	ถนนงามวงศ์วาน	\N	\N	5005	2556	423	2	2.9	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	5-2878-27888-51-8	\N	3	นภาพร	\N	ทั่วถึง	2	1	0	0	8	ถ.รัฐพัฒนา	\N	\N	5004	2561	111	2	2.27	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	5-3643-32359-12-2	\N	1	ศุภณัฐ	\N	ศักดิ์สิทธิ์	1	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	5002	2567	103	1	3.05	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	1-5476-30119-66-6	\N	1	ปิยังกูร	\N	ทั่วถึง	1	1	0	0	3	ถนนสาทร	\N	\N	5004	2559	113	1	3.34	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	2-7399-50412-66-1	\N	1	ณัฐวรรธน์	\N	บุญรอด	1	1	0	0	10	ถนนพหลโยธิน	\N	\N	5002	2558	421	3	2.1	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	4-2497-12102-63-1	\N	1	ชูเกียรติ	\N	เจริญชัย	1	1	0	0	1	ถนนช้างเผือก	\N	\N	5002	2567	101	2	3.86	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	3-3736-15768-63-9	\N	1	ณัฐวรรธน์	\N	เพียรดี	1	1	0	0	2	ถนนห้วยแก้ว	\N	\N	5001	2563	105	1	3.59	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	5	10010002	2-4807-38020-23-6	\N	2	กัญญา	\N	นิ่มนวล	2	1	0	0	6	ถนนศรีนครินทร์	\N	\N	5002	2563	105	2	3.88	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	4-2081-96240-45-6	\N	1	ธัชพล	\N	อ่อนน้อม	1	1	0	0	1	ถนนงามวงศ์วาน	\N	\N	5003	2567	103	2	2.58	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	3-5127-22418-86-6	\N	1	รชานนท์	\N	ขาวสะอาด	1	1	0	0	7	ถนนสรงประภา	\N	\N	5005	2567	103	1	3.48	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	1	10010002	8-7264-76981-91-4	\N	3	ธัญชนก	\N	มงคล	2	1	0	0	9	ถนนพหลโยธิน	\N	\N	5004	2557	422	2	2.04	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	3	10010002	4-2300-17854-27-6	\N	1	ภูมิพัฒน์	\N	นิ่มนวล	1	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	5001	2561	111	1	3.53	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	8-6385-27598-45-6	\N	1	อภิวัฒน์	\N	เจริญชัย	1	1	0	0	1	ถนนเจริญกรุง	\N	\N	5002	2562	106	1	3.85	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	4-4372-80688-16-4	\N	3	นวลจันทร์	\N	งามดี	2	1	0	0	4	ถนนบายพาส	\N	\N	5001	2560	112	3	2.66	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	4-1853-93147-28-4	\N	3	ธัญชนก	\N	ยิ้มแย้ม	2	1	0	0	3	ถนนบรมราชชนนี	\N	\N	5001	2566	102	2	2.6	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	8-6103-31516-35-4	\N	1	มานพ	\N	ศักดิ์สิทธิ์	1	1	0	0	7	ถนนศรีนครินทร์	\N	\N	5002	2567	101	3	2.62	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	8-2310-57131-60-7	\N	1	พิพัฒน์	\N	พันธุ์ดี	1	1	0	0	3	ถ.เอกชัย	\N	\N	5005	2558	421	3	2.4	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	7-2363-49351-86-9	\N	3	อัมพร	\N	งามดี	2	1	0	0	3	ถนนประดิษฐ์มนูธรรม	\N	\N	5002	2566	102	1	3.64	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	3	10010002	8-2178-53677-27-8	\N	1	สิรภพ	\N	เจริญชัย	1	1	0	0	4	ถนนชัยพฤกษ์	\N	\N	5004	2558	421	2	2.57	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	3	10010002	7-7465-58908-59-8	\N	1	ธนภัทร	\N	สุขสบาย	1	1	0	0	5	ถนนงามวงศ์วาน	\N	\N	5005	2566	102	2	3.11	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	5-6711-76795-72-6	\N	2	ปัณฑิตา	\N	เจริญชัย	2	1	0	0	1	ถนนบายพาส	\N	\N	5005	2567	103	1	3.57	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	1	10010002	1-3422-44253-87-8	\N	2	วันวิสา	\N	พงษ์ไพร	2	1	0	0	3	ถนนเยาวราช	\N	\N	5004	2567	103	2	3.34	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	7-7515-86829-20-9	\N	1	ไกรวุฒิ	\N	ชูศรี	1	1	0	0	4	ถนนอุดรดุษฎี	\N	\N	5002	2567	101	1	3.66	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	7-6045-63950-21-2	\N	1	ภัคพล	\N	หอมหวาน	1	1	0	0	10	ถนนมิตรภาพ	\N	\N	5003	2567	103	3	3.39	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	3-9056-10206-22-2	\N	1	กันตภณ	\N	ทั่วถึง	1	1	0	0	7	ถนนเจริญกรุง	\N	\N	5002	2566	102	3	2.96	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	3-4244-73762-33-9	\N	3	นวลจันทร์	\N	สีดา	2	1	0	0	2	ถ.ประชาสามัคคี	\N	\N	5004	2556	423	1	2.75	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	7-8220-92160-89-2	\N	1	ธนาธิป	\N	ดีสมัย	1	1	0	0	3	ถนนบรมราชชนนี	\N	\N	5001	2561	111	1	2.67	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	4-8829-73595-96-2	\N	3	กัญญาณัฐ	\N	ศรีสุข	2	1	0	0	1	ถนนรัตนาธิเบศร์	\N	\N	5003	2561	111	2	2.25	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	1-7154-89034-76-5	\N	2	ประภา	\N	เพียรดี	2	1	0	0	8	ถ.เอกชัย	\N	\N	5005	2557	422	1	2.42	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	6-7528-59602-88-1	\N	3	จิตรลดา	\N	ชัยมงคล	2	1	0	0	6	ถนนช้างเผือก	\N	\N	5003	2561	111	2	3.67	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	5-5072-58290-67-8	\N	1	ธนภัทร	\N	บริบูรณ์	1	1	0	0	9	ถนนมาลัยแมน	\N	\N	5004	2560	112	1	3.2	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	1-6333-98857-66-4	\N	1	ธนภัทร	\N	ยิ้มแย้ม	1	1	0	0	10	ถ.บ้านโป่ง	\N	\N	5003	2562	106	3	2.72	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	2-7305-48517-87-4	\N	2	วันวิสา	\N	สุวรรณภูมิ	2	1	0	0	3	ถนนเจริญกรุง	\N	\N	5004	2559	113	3	3.71	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	3	10010002	8-3753-68495-24-8	\N	1	ปรเมศวร์	\N	กิตติคุณ	1	1	0	0	9	ถนนสุรวงศ์	\N	\N	5001	2566	102	3	3.99	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	1-3625-52795-59-5	\N	1	นรวิชญ์	\N	เพ็งพา	1	1	0	0	4	ถนนเยาวราช	\N	\N	5001	2560	112	2	3.99	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	5	10010002	2-6452-39334-83-2	\N	2	รุ่งอรุณ	\N	เพียรดี	2	1	0	0	6	ถนนบายพาส	\N	\N	5002	2564	104	3	3.51	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	2-2824-21683-53-4	\N	3	นวลจันทร์	\N	พรสวรรค์	2	1	0	0	2	ถนนกลางเมือง	\N	\N	5002	2561	111	2	2.41	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	4-7359-65535-50-6	\N	1	ณัฐวุฒิ	\N	เจริญชัย	1	1	0	0	3	ถนนเจริญกรุง	\N	\N	5005	2556	423	2	2.12	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	5	10010002	5-4586-75514-97-8	\N	1	ชนะชัย	\N	ประสิทธิ์ผล	1	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	5001	2558	421	2	2.63	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	5	10010002	2-5480-85231-71-4	\N	1	เอกพงษ์	\N	เพียรดี	1	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	5001	2558	421	2	2.62	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	3-8987-61355-48-3	\N	3	วรรณภา	\N	รักษ์ไทย	2	1	0	0	1	ถนนประดิษฐ์มนูธรรม	\N	\N	5002	2562	106	3	3.47	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	3	10010002	5-5626-35571-99-9	\N	3	เกวลิน	\N	สุจริต	2	1	0	0	7	ถนนเพชรเกษม	\N	\N	5004	2557	422	2	2.78	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	3-3253-67918-99-8	\N	1	ณัฐวุฒิ	\N	งามดี	1	1	0	0	5	ถนนชัยพฤกษ์	\N	\N	5005	2563	105	3	2.61	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	1	10010002	2-3418-59355-64-3	\N	1	นรวิชญ์	\N	พรสวรรค์	1	1	0	0	1	ถนนเพชรเกษม	\N	\N	5002	2562	106	2	3.45	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	7-3434-92178-61-4	\N	2	กาญจนา	\N	แสงสว่าง	2	1	0	0	1	ถนนรามคำแหง	\N	\N	5001	2566	102	3	3.01	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	5	10010002	7-2468-70774-93-7	\N	1	ธัชพล	\N	กิตติคุณ	1	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	5003	2557	422	1	3.31	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	4-1377-86919-83-8	\N	2	พิมพ์ชนก	\N	ศรีสุข	2	1	0	0	5	ถนนเพชรเกษม	\N	\N	5001	2561	111	2	3.35	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	6-2040-80452-33-7	\N	1	วีรชัย	\N	ลือชา	1	1	0	0	1	ถนนสุดสาคร	\N	\N	5004	2566	102	3	2.69	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	3-1087-82708-67-6	\N	2	ชลธิชา	\N	งามดี	2	1	0	0	2	ถนนลาดพร้าว	\N	\N	5002	2558	421	1	3.72	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	1-2386-26346-74-5	\N	1	สุทธิพงษ์	\N	คงมั่น	1	1	0	0	6	ถนนนวมินทร์	\N	\N	5002	2562	106	3	2.51	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	5-9750-68316-27-8	\N	1	ภัคพล	\N	เพียรดี	1	1	0	0	6	ถนนเจริญกรุง	\N	\N	5001	2567	103	2	2.28	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	3-5910-38208-27-9	\N	2	จิตรลดา	\N	สุดสวย	2	1	0	0	4	ถนนมิตรภาพ	\N	\N	5001	2558	421	1	2.07	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	3-7554-69777-20-5	\N	3	อรณิชา	\N	ใจดี	2	1	0	0	7	ถนนชัยพฤกษ์	\N	\N	5005	2557	422	2	2.76	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	3-7876-30118-50-7	\N	1	วรากร	\N	ยิ้มแย้ม	1	1	0	0	7	ถนนสุขุมวิท	\N	\N	5003	2566	102	3	3.06	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	7-2080-53169-91-2	\N	1	วรากร	\N	นามมนตรี	1	1	0	0	6	ถนนช้างเผือก	\N	\N	5001	2564	104	1	3.43	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	4-7203-23762-25-3	\N	2	นันทพร	\N	นามมนตรี	2	1	0	0	9	ถนนนิมมานเหมินท์	\N	\N	5001	2563	105	2	3.96	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	2-1785-32380-50-7	\N	3	ภัทรวดี	\N	สุดสวย	2	1	0	0	3	ถนนมิตรภาพ	\N	\N	5005	2560	112	3	2.54	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	5	10010002	3-3337-59650-82-5	\N	2	กาญจนา	\N	หอมหวาน	2	1	0	0	1	ถนนกลางเมือง	\N	\N	5001	2561	111	3	2.48	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	6-8678-75828-46-5	\N	1	ณัฐวรรธน์	\N	คงพิทักษ์	1	1	0	0	7	ถนนเจริญกรุง	\N	\N	5004	2562	106	1	2.88	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	3	10010002	2-2302-20052-40-2	\N	1	พิพัฒน์	\N	ยิ้มแย้ม	1	1	0	0	3	ถนนรัตนาธิเบศร์	\N	\N	5001	2561	111	2	3.59	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	7-9334-27881-71-8	\N	1	เอกพงษ์	\N	พันธุ์ดี	1	1	0	0	9	ถนนนวมินทร์	\N	\N	5005	2567	101	1	3.94	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	7-9754-55227-41-9	\N	1	ธัชพล	\N	สุขสบาย	1	1	0	0	10	ถนนลาดพร้าว	\N	\N	5005	2556	423	3	2.01	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	1-7925-74947-58-3	\N	2	รัตนาภรณ์	\N	สมบูรณ์	2	1	0	0	6	ถนนรามคำแหง	\N	\N	5001	2563	105	1	3.03	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	5-5337-37926-10-7	\N	2	แสงดาว	\N	สุขสันต์	2	1	0	0	4	ถนนนิมมานเหมินท์	\N	\N	5005	2560	112	2	2.6	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	1	10010002	8-6382-49105-55-2	\N	1	เจษฎา	\N	นิ่มนวล	1	1	0	0	1	ถนนมิตรภาพ	\N	\N	5004	2564	104	2	2.21	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	2-9668-77412-29-7	\N	1	ธัชพล	\N	สุวรรณภูมิ	1	1	0	0	2	ถ.บ้านโป่ง	\N	\N	5001	2560	112	2	2.98	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	5-6971-66143-33-9	\N	1	อภิวัฒน์	\N	สง่างาม	1	1	0	0	5	ถนนเพชรเกษม	\N	\N	5003	2562	106	2	2.79	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	3	10010002	6-4251-24505-34-5	\N	3	รุ่งอรุณ	\N	เพ็งพา	2	1	0	0	1	ถนนสรงประภา	\N	\N	5002	2567	101	3	3.15	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	5-2946-65193-72-9	\N	3	สุนิสา	\N	ทองดี	2	1	0	0	8	ถนนสรงประภา	\N	\N	5002	2563	105	2	3.92	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	1-3066-30387-54-9	\N	3	ประภา	\N	วิริยะ	2	1	0	0	1	ถนนสุรวงศ์	\N	\N	5004	2567	103	1	3.92	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	7-8867-47940-46-8	\N	1	ณัฐวรรธน์	\N	สุขสันต์	1	1	0	0	2	ถนนอุดรดุษฎี	\N	\N	5003	2566	102	3	3.61	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	2-5317-42421-95-7	\N	1	ทักษิณ	\N	รักษ์ไทย	1	1	0	0	4	ถ.เอกชัย	\N	\N	5005	2567	101	1	2.92	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	5	10010002	3-4758-25789-26-7	\N	1	อนุชา	\N	สีดา	1	1	0	0	1	ถนนกาญจนาภิเษก	\N	\N	5005	2564	104	1	2.54	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	5	10010002	1-7231-63385-77-5	\N	1	อภิวัฒน์	\N	สกุลดี	1	1	0	0	4	ถนนสีลม	\N	\N	5001	2564	104	1	2.36	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	2-5411-57654-45-6	\N	3	อัมพร	\N	แสงสว่าง	2	1	0	0	7	ถนนสุรวงศ์	\N	\N	5005	2564	104	3	2.29	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	1	10010002	4-5674-71873-45-2	\N	2	วรรณภา	\N	ทองดี	2	1	0	0	7	ถนนศรีนครินทร์	\N	\N	5001	2564	104	3	3.54	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	3-6426-57260-56-9	\N	3	ศิริพร	\N	ชัยมงคล	2	1	0	0	10	ถนนกลางเมือง	\N	\N	5003	2556	423	1	3.34	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	2-3137-92517-87-2	\N	1	ชัยชนะ	\N	นามมนตรี	1	1	0	0	1	ถนนอ่อนนุช	\N	\N	5002	2561	111	2	2.36	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	5-8769-36476-78-3	\N	1	สมศักดิ์	\N	มีสุข	1	1	0	0	1	ถนนสรงประภา	\N	\N	5001	2559	113	3	3.24	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	5	10010002	8-2923-67163-18-8	\N	1	รชานนท์	\N	ศักดิ์สิทธิ์	1	1	0	0	7	ถนนเจริญกรุง	\N	\N	5003	2567	103	2	3.81	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	1-4116-62100-73-9	\N	1	ดิศรณ์	\N	คงพิทักษ์	1	1	0	0	9	ถนนงามวงศ์วาน	\N	\N	5003	2563	105	2	2.09	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	7-5448-37122-33-1	\N	1	กวินท์	\N	งามดี	1	1	0	0	3	ถนนสาทร	\N	\N	5005	2567	101	3	3.67	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	5	10010002	4-5855-45194-80-2	\N	1	ธนพัฒน์	\N	บริบูรณ์	1	1	0	0	3	ถนนสีลม	\N	\N	5005	2567	101	2	2.96	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	1	10010002	5-3178-45446-16-4	\N	1	ปิยังกูร	\N	พงษ์ไพร	1	1	0	0	4	ถนนนวมินทร์	\N	\N	5003	2564	104	3	2.47	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	5-3189-63522-88-5	\N	1	ธนภัทร	\N	อ่อนน้อม	1	1	0	0	6	ถนนรัตนาธิเบศร์	\N	\N	5003	2566	102	2	2.99	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	2-7258-95698-42-9	\N	1	สมชาย	\N	อินทร์ชัย	1	1	0	0	4	ถ.ประชาสามัคคี	\N	\N	5003	2556	423	2	3.94	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	7-3550-68465-39-7	\N	1	ณัฐวุฒิ	\N	นามมนตรี	1	1	0	0	6	ถนนชัยพฤกษ์	\N	\N	5002	2560	112	3	3.62	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	8-3955-94877-46-1	\N	3	กัญญาณัฐ	\N	สมบูรณ์	2	1	0	0	5	ถนนราษฎร์บูรณะ	\N	\N	5004	2564	104	1	2.54	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	7-5018-69640-92-7	\N	1	ธัชพล	\N	สุจริต	1	1	0	0	2	ถนนเจริญกรุง	\N	\N	5005	2567	101	1	2.72	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	5	10010002	1-2802-11776-92-1	\N	1	วรพล	\N	งามดี	1	1	0	0	3	ถนนสุรวงศ์	\N	\N	5001	2557	422	1	2.76	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	2-9886-54353-20-4	\N	1	กันตภณ	\N	รักษ์ไทย	1	1	0	0	3	ถ.เอกชัย	\N	\N	5005	2559	113	1	3.92	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	5-9906-26131-12-1	\N	3	รัตนาภรณ์	\N	ชัยมงคล	2	1	0	0	2	ถนนนวมินทร์	\N	\N	5004	2560	112	1	2.11	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	7-3414-56309-93-5	\N	3	ภัทรวดี	\N	รักษ์ไทย	2	1	0	0	4	ถนนบายพาส	\N	\N	5001	2567	103	1	2.61	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	5-6854-19999-88-6	\N	1	วุฒิพงษ์	\N	เพ็งพา	1	1	0	0	2	ถนนกลางเมือง	\N	\N	5001	2557	422	1	3.91	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	3-7967-29689-95-5	\N	1	กิตติภณ	\N	คงพิทักษ์	1	1	0	0	10	ถนนวิภาวดีรังสิต	\N	\N	5002	2563	105	2	3.06	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	3	10010002	1-3435-95964-28-6	\N	3	ภัทรวดี	\N	กิตติคุณ	2	1	0	0	3	ถนนบายพาส	\N	\N	5003	2559	113	3	3.6	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	5-3370-21855-51-3	\N	3	สุมาลี	\N	ปัญญาดี	2	1	0	0	3	ถนนบายพาส	\N	\N	5001	2567	103	3	2.97	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	6-3264-95715-41-7	\N	3	ชนิดา	\N	สกุลดี	2	1	0	0	7	ถนนประดิษฐ์มนูธรรม	\N	\N	5004	2559	113	3	3.59	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	7-9633-85743-98-4	\N	3	บุษยา	\N	บุญรอด	2	1	0	0	2	ถนนสุรวงศ์	\N	\N	5005	2557	422	2	2.17	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	3-2804-17808-54-6	\N	2	พิมพ์ชนก	\N	มงคล	2	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	5001	2559	113	3	2.95	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	2-3344-59474-13-7	\N	3	นันทพร	\N	พงษ์ไพร	2	1	0	0	6	ถนนรัตนาธิเบศร์	\N	\N	5002	2567	101	1	3.62	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	1-3406-57873-28-2	\N	1	บุญยิ่ง	\N	ชูศรี	1	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	5001	2564	104	3	3.77	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	3-9641-49257-70-7	\N	1	สุทธิพงษ์	\N	สุขสันต์	1	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	5004	2563	105	1	2.94	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	3-9245-31017-11-7	\N	1	ศิวกร	\N	ศรีสุข	1	1	0	0	7	ถ.รัฐพัฒนา	\N	\N	5002	2564	104	3	2.26	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	2-9544-59487-26-4	\N	3	ดรุณี	\N	วังขวา	2	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	5002	2560	112	1	2.54	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	8-8821-51050-93-7	\N	1	ธัชพล	\N	สมบูรณ์	1	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	5005	2556	423	1	3.63	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	2-6942-89061-52-1	\N	1	ประพันธ์	\N	อ่อนน้อม	1	1	0	0	4	ถนนวิภาวดีรังสิต	\N	\N	5004	2563	105	2	2.22	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	5-4075-82311-35-1	\N	1	ปิยังกูร	\N	จันทร์แก้ว	1	1	0	0	4	ถนนกาญจนาภิเษก	\N	\N	5001	2561	111	3	2.22	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	5	10010002	6-2527-50449-11-6	\N	1	สุทธิพงษ์	\N	ดำรงค์	1	1	0	0	5	ถนนสุดสาคร	\N	\N	5001	2560	112	2	2.09	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	2-6428-63383-74-2	\N	1	ณัฐวุฒิ	\N	งามดี	1	1	0	0	9	ถนนชัยพฤกษ์	\N	\N	5004	2561	111	1	3.46	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	1-5753-31131-29-8	\N	1	มานพ	\N	ธนาคาร	1	1	0	0	2	ถนนบรมราชชนนี	\N	\N	5004	2559	113	3	3.74	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	6-8331-27196-53-5	\N	1	นรวิชญ์	\N	พรสวรรค์	1	1	0	0	6	ถนนอุดรดุษฎี	\N	\N	5002	2561	111	3	3.13	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	2-3496-84304-90-8	\N	1	สมศักดิ์	\N	สง่างาม	1	1	0	0	2	ถนนพหลโยธิน	\N	\N	5004	2562	106	1	3.99	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	6-3780-48745-30-2	\N	1	ชูเกียรติ	\N	ขาวสะอาด	1	1	0	0	5	ถนนกลางเมือง	\N	\N	5005	2567	101	2	2.64	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	8-3301-26248-82-8	\N	2	กัญญาณัฐ	\N	สมบูรณ์	2	1	0	0	1	ถนนกลางเมือง	\N	\N	5004	2564	104	2	3.96	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	6-7122-20943-97-7	\N	3	จิราพร	\N	มงคล	2	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	5005	2562	106	2	2.73	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	1-3532-23801-47-7	\N	2	แสงดาว	\N	นิ่มนวล	2	1	0	0	3	ถนนสุดสาคร	\N	\N	5001	2564	104	3	3.68	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	8-2787-21248-33-2	\N	1	วิชญ์พล	\N	เจริญชัย	1	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	5004	2560	112	2	2.93	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	3	10010002	8-4483-72419-24-5	\N	1	ธัชพล	\N	ชัยมงคล	1	1	0	0	8	ถนนลาดพร้าว	\N	\N	5001	2557	422	2	3.99	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	7-2022-57381-65-8	\N	1	สุรชัย	\N	รักษ์ไทย	1	1	0	0	4	ถนนรัตนาธิเบศร์	\N	\N	5002	2564	104	3	2.26	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	3	10010002	2-3322-19077-45-7	\N	1	ภูมิพัฒน์	\N	งามดี	1	1	0	0	2	ถนนนิมมานเหมินท์	\N	\N	5004	2567	103	2	3.34	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	7-6603-48915-31-4	\N	2	สุนิสา	\N	เพียรดี	2	1	0	0	6	ถนนมาลัยแมน	\N	\N	5003	2561	111	1	2.37	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	3	10010002	1-4253-20198-95-3	\N	2	กาญจนา	\N	สุดสวย	2	1	0	0	6	ถนนห้วยแก้ว	\N	\N	5004	2558	421	3	3.14	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	7-5305-78248-10-8	\N	1	อภิวัฒน์	\N	บริบูรณ์	1	1	0	0	3	ถ.ประชาสามัคคี	\N	\N	5002	2562	106	2	2.23	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	3-7185-38329-54-4	\N	1	กิตติภณ	\N	คงมั่น	1	1	0	0	4	ถนนพหลโยธิน	\N	\N	5002	2561	111	3	3.18	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	8-7783-63790-55-6	\N	2	ทิพย์สุดา	\N	ขาวสะอาด	2	1	0	0	9	ถนนอุดรดุษฎี	\N	\N	5003	2561	111	1	3.46	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	3	10010002	3-9892-67131-58-5	\N	2	สุภัสสรา	\N	บริบูรณ์	2	1	0	0	7	ถนนวิภาวดีรังสิต	\N	\N	5004	2562	106	1	3.11	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	7-2698-75064-89-9	\N	1	ศุภณัฐ	\N	พรสวรรค์	1	1	0	0	2	ถ.ประชาสามัคคี	\N	\N	5001	2566	102	3	2.52	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	7-2875-35632-70-2	\N	1	บุญยิ่ง	\N	พันธุ์ดี	1	1	0	0	6	ถ.รัฐพัฒนา	\N	\N	5004	2557	422	1	3.55	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	5-6036-64357-96-4	\N	3	นวลจันทร์	\N	สุขสบาย	2	1	0	0	1	ถนนมาลัยแมน	\N	\N	5003	2561	111	3	2.71	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	3	10010002	6-6490-32336-83-7	\N	1	ธนภัทร	\N	มณีรัตน์	1	1	0	0	4	ถนนประดิษฐ์มนูธรรม	\N	\N	5002	2559	113	3	3.64	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	7-3846-62837-50-9	\N	3	กุลธิดา	\N	สุขสันต์	2	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	5001	2556	423	2	2.26	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	5	10010002	7-5263-82470-30-6	\N	1	ชนะชัย	\N	วังขวา	1	1	0	0	4	ถนนบรมราชชนนี	\N	\N	5002	2558	421	1	3.26	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	2-7265-13314-26-8	\N	1	ภูมิพัฒน์	\N	สกุลดี	1	1	0	0	6	ถนนศรีนครินทร์	\N	\N	5001	2567	103	1	2.25	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	7-5267-96410-16-5	\N	1	ชัยชนะ	\N	อินทร์ชัย	1	1	0	0	2	ถนนชัยพฤกษ์	\N	\N	5003	2559	113	3	3.68	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	2-2754-28590-46-5	\N	1	วสันต์	\N	ชูศรี	1	1	0	0	3	ถนนบรมราชชนนี	\N	\N	5001	2563	105	2	3.85	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	1-7778-19643-72-2	\N	1	วุฒิพงษ์	\N	มงคล	1	1	0	0	4	ถนนมาลัยแมน	\N	\N	5003	2556	423	2	2.2	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	3-1515-25362-53-6	\N	3	ชนิดา	\N	พรสวรรค์	2	1	0	0	8	ถนนนวมินทร์	\N	\N	5002	2562	106	2	2.02	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	1-9486-77075-29-4	\N	1	ดิศรณ์	\N	พรประเสริฐ	1	1	0	0	6	ถนนรามคำแหง	\N	\N	5003	2560	112	1	3.21	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	3-5384-45870-71-4	\N	1	ภูมิพัฒน์	\N	วิไลวรรณ	1	1	0	0	2	ถนนมิตรภาพ	\N	\N	5002	2566	102	1	3.59	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	4-5605-61488-23-5	\N	3	พรรษา	\N	สกุลดี	2	1	0	0	3	ถนนสาทร	\N	\N	5005	2561	111	1	2.65	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	7-8033-36177-82-6	\N	3	อัมพร	\N	สกุลดี	2	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	5005	2562	106	2	3.25	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	5	10010002	6-7525-13924-24-3	\N	2	รัตนาภรณ์	\N	วิริยะ	2	1	0	0	6	ถนนอุดรดุษฎี	\N	\N	5003	2563	105	2	2.59	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	3-6151-26030-11-6	\N	1	สมชาย	\N	พงษ์ไพร	1	1	0	0	1	ถนนช้างเผือก	\N	\N	5001	2561	111	3	2.87	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	5-4476-79109-37-2	\N	1	เจษฎา	\N	ดำรงค์	1	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	5003	2567	101	3	2.6	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	4-4229-16509-73-8	\N	1	สุทธิพงษ์	\N	อ่อนน้อม	1	1	0	0	1	ถนนกาญจนาภิเษก	\N	\N	5004	2563	105	2	3.63	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	5	10010002	4-1348-47360-12-1	\N	2	สุภัสสรา	\N	มีสุข	2	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	5002	2566	102	2	3.39	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	1-2137-71589-22-7	\N	1	ธัชพล	\N	ทองดี	1	1	0	0	5	ถนนกาญจนาภิเษก	\N	\N	5005	2560	112	1	2.67	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	5	10010002	1-7444-49117-99-8	\N	3	ประภา	\N	ประสิทธิ์ผล	2	1	0	0	8	ถนนรามคำแหง	\N	\N	5001	2559	113	2	2.99	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	6-8138-39667-31-2	\N	2	เพ็ญพักตร์	\N	มณีรัตน์	2	1	0	0	4	ถนนกลางเมือง	\N	\N	5002	2562	106	1	2.28	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	5-2229-44567-52-7	\N	1	อนุชา	\N	แสงสว่าง	1	1	0	0	5	ถนนราษฎร์บูรณะ	\N	\N	5003	2556	423	1	2.1	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	7-8320-97586-25-9	\N	1	มานพ	\N	บริบูรณ์	1	1	0	0	9	ถนนสุรวงศ์	\N	\N	5001	2561	111	2	3.75	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	5-2356-56269-81-4	\N	3	รุ่งอรุณ	\N	นามมนตรี	2	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	5003	2566	102	1	2.64	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	7-4078-73916-23-6	\N	1	วุฒิพงษ์	\N	แสงสว่าง	1	1	0	0	4	ถนนเจริญกรุง	\N	\N	5002	2562	106	3	2.43	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	3-4584-57663-59-8	\N	3	ประภา	\N	วังขวา	2	1	0	0	10	ถนนโชคชัย	\N	\N	5004	2564	104	3	2.39	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	5-2672-29305-69-2	\N	1	ชูเกียรติ	\N	ประสิทธิ์ผล	1	1	0	0	2	ถนนสุรวงศ์	\N	\N	5002	2556	423	2	2.85	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	8-6766-44809-25-9	\N	1	เจษฎา	\N	สมบูรณ์	1	1	0	0	2	ถนนมิตรภาพ	\N	\N	5003	2567	103	2	3.39	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	8-5466-58467-22-1	\N	2	สิริมา	\N	ประสิทธิ์ผล	2	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	5005	2558	421	3	2.67	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	8-9497-66828-23-1	\N	1	ศิวกร	\N	ดีสมัย	1	1	0	0	4	ถนนรามคำแหง	\N	\N	5004	2557	422	3	2.55	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	5	10010002	2-5513-39683-89-7	\N	1	รัฐนนท์	\N	แสงสว่าง	1	1	0	0	7	ถนนสุดสาคร	\N	\N	5001	2558	421	2	2.48	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	4-6695-93479-46-5	\N	1	วิชญ์พล	\N	สีดา	1	1	0	0	1	ถนนเพชรเกษม	\N	\N	5003	2558	421	1	2.34	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	4-3789-51302-97-2	\N	1	ธนพัฒน์	\N	สุดสวย	1	1	0	0	3	ถนนศรีนครินทร์	\N	\N	5005	2557	422	3	2.61	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	5-2261-32377-96-1	\N	2	พรรษา	\N	สุขสบาย	2	1	0	0	10	ถนนมิตรภาพ	\N	\N	5004	2557	422	2	2.04	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	1-5762-39922-77-9	\N	2	มาลัย	\N	กิตติคุณ	2	1	0	0	3	ถนนชัยพฤกษ์	\N	\N	5002	2560	112	1	2.09	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	5-8970-43231-56-8	\N	1	ชนะชัย	\N	ขาวสะอาด	1	1	0	0	1	ถนนมิตรภาพ	\N	\N	5003	2558	421	2	3.47	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	1-3423-63781-38-3	\N	3	จันทร์เพ็ญ	\N	พรประเสริฐ	2	1	0	0	6	ถ.บ้านโป่ง	\N	\N	5005	2567	103	1	2.69	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	4-7189-93720-23-5	\N	1	ปัณณทัต	\N	ดำรงค์	1	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	5004	2566	102	1	3.62	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	3	10010002	5-6067-34978-15-9	\N	1	สิรภพ	\N	สุจริต	1	1	0	0	6	ถนนรามคำแหง	\N	\N	5003	2563	105	2	3.18	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	3-8640-99249-29-9	\N	3	พรรษา	\N	พันธุ์ดี	2	1	0	0	5	ถนนประดิษฐ์มนูธรรม	\N	\N	5001	2567	101	2	3.89	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	1-4560-47095-85-2	\N	1	พิพัฒน์	\N	กิตติคุณ	1	1	0	0	1	ถ.บ้านโป่ง	\N	\N	5003	2556	423	2	2.03	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	5-9224-97205-81-3	\N	3	พิมพ์ชนก	\N	สุวรรณภูมิ	2	1	0	0	2	ถนนกาญจนาภิเษก	\N	\N	5001	2567	101	2	2.71	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	5	10010002	1-8752-56482-41-7	\N	1	วรพล	\N	ดีสมัย	1	1	0	0	7	ถนนสุดสาคร	\N	\N	5004	2562	106	1	2.58	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	3	10010002	6-3280-99564-35-5	\N	1	สิรภพ	\N	ขาวสะอาด	1	1	0	0	3	ถนนมาลัยแมน	\N	\N	5005	2567	103	1	3.22	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	8-9942-34034-58-7	\N	1	พิพัฒน์	\N	ขาวสะอาด	1	1	0	0	2	ถนนสรงประภา	\N	\N	5001	2557	422	3	3.85	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	7-7721-70461-13-9	\N	3	ดวงใจ	\N	วิริยะ	2	1	0	0	1	ถนนมาลัยแมน	\N	\N	5003	2567	103	2	2.97	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	3	10010002	6-3085-91381-79-5	\N	1	ทัศนัย	\N	บุญมี	1	1	0	0	1	ถนนสุดสาคร	\N	\N	5005	2564	104	1	3.24	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	1-2387-17168-44-2	\N	1	ธัชพล	\N	เพียรดี	1	1	0	0	6	ถนนเพชรเกษม	\N	\N	5001	2558	421	3	2.92	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	1-4359-77667-28-9	\N	3	ดรุณี	\N	สุดสวย	2	1	0	0	8	ถนนสรงประภา	\N	\N	5003	2556	423	1	3.48	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	3	10010002	1-8945-91744-98-4	\N	1	ณัฐวรรธน์	\N	ยิ้มแย้ม	1	1	0	0	2	ถนนงามวงศ์วาน	\N	\N	5002	2562	106	3	2.62	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	2-8761-13231-74-8	\N	1	อภิวัฒน์	\N	คงพิทักษ์	1	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	5001	2567	101	1	2.87	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	5-8194-96266-88-2	\N	1	พิพัฒน์	\N	ประสิทธิ์ผล	1	1	0	0	7	ถนนชัยพฤกษ์	\N	\N	5004	2560	112	1	3.68	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	4-8801-72975-47-5	\N	1	ธนาธิป	\N	รักษ์ไทย	1	1	0	0	2	ถ.บ้านโป่ง	\N	\N	5002	2556	423	3	3.48	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	7-3427-13666-46-8	\N	3	รุ่งอรุณ	\N	ประสิทธิ์ผล	2	1	0	0	2	ถนนบายพาส	\N	\N	5004	2564	104	2	2.95	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	5	10010002	6-3282-71329-68-5	\N	1	มานพ	\N	ขาวสะอาด	1	1	0	0	1	ถนนราษฎร์บูรณะ	\N	\N	5001	2567	103	2	2.28	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	3-6764-95974-82-6	\N	2	วาสนา	\N	สุวรรณภูมิ	2	1	0	0	8	ถนนสรงประภา	\N	\N	5005	2564	104	3	2.31	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	3-9306-96364-77-5	\N	3	ประภา	\N	ประสิทธิ์ผล	2	1	0	0	3	ถนนห้วยแก้ว	\N	\N	5001	2558	421	2	3.93	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	2-2740-75461-96-8	\N	3	มาลัย	\N	ใจดี	2	1	0	0	6	ถนนสีลม	\N	\N	5001	2563	105	3	2.32	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	5-2875-14904-19-8	\N	1	ชนะชัย	\N	สมบูรณ์	1	1	0	0	6	ถนนสุขุมวิท	\N	\N	5004	2556	423	1	2.12	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	4-4206-43095-72-8	\N	1	ณัฐวุฒิ	\N	จันทร์แก้ว	1	1	0	0	5	ถนนสีลม	\N	\N	5004	2564	104	1	3.98	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	5	10010002	1-2576-36678-14-3	\N	1	เอกพงษ์	\N	เพ็งพา	1	1	0	0	1	ถนนกลางเมือง	\N	\N	5004	2562	106	1	2.17	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	5	10010002	4-8761-75647-55-6	\N	2	ดรุณี	\N	ชัยมงคล	2	1	0	0	10	ถนนประดิษฐ์มนูธรรม	\N	\N	5002	2557	422	2	2.38	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	3-9474-49089-22-2	\N	1	วรากร	\N	มีสุข	1	1	0	0	8	ถนนสีลม	\N	\N	5004	2567	101	1	3.35	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	5-5118-61173-55-2	\N	1	ไกรวุฒิ	\N	บุญรอด	1	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	5003	2556	423	1	3.64	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	7-1928-81557-99-2	\N	1	ปิยังกูร	\N	ดำรงค์	1	1	0	0	10	ถ.เอกชัย	\N	\N	5002	2560	112	3	3	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	1-3282-36769-80-6	\N	2	นวลจันทร์	\N	ทองดี	2	1	0	0	1	ถนนสุรวงศ์	\N	\N	5003	2567	101	2	2.8	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	2-8844-26969-44-1	\N	2	ชลธิชา	\N	สุวรรณภูมิ	2	1	0	0	2	ถนนลาดพร้าว	\N	\N	5001	2562	106	3	3.48	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	4-1351-17255-13-4	\N	2	วาสนา	\N	อ่อนน้อม	2	1	0	0	9	ถนนบายพาส	\N	\N	5003	2560	112	2	2.61	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	7-7993-82029-27-2	\N	1	นพรัตน์	\N	ลือชา	1	1	0	0	8	ถนนรามคำแหง	\N	\N	5001	2560	112	2	3.39	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010009	3-8474-11027-20-3	\N	2	กัญญา	\N	ใจดี	2	1	0	0	7	ถนนโชคชัย	\N	\N	9204	2557	422	3	3.01	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010002	1-4721-64141-78-1	\N	2	มณีรัตน์	\N	ชัยมงคล	2	1	0	0	1	ถนนสุรวงศ์	\N	\N	5004	2562	106	1	2.46	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	6-6728-88959-93-4	\N	1	วรากร	\N	แสงสว่าง	1	1	0	0	5	ถนนสรงประภา	\N	\N	5002	2557	422	1	2.57	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	4-9108-56787-38-8	\N	2	กาญจนา	\N	เพียรดี	2	1	0	0	5	ถนนกลางเมือง	\N	\N	5001	2556	423	2	3.88	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	2-1884-55434-62-8	\N	2	นวลจันทร์	\N	พรประเสริฐ	2	1	0	0	5	ถนนบรมราชชนนี	\N	\N	5003	2562	106	3	3.08	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	4-3011-58809-28-1	\N	1	ปรเมศวร์	\N	สุขสันต์	1	1	0	0	4	ถ.ประชาสามัคคี	\N	\N	5005	2567	101	2	3.61	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	5-2384-17827-45-7	\N	2	สุภัสสรา	\N	กิตติคุณ	2	1	0	0	8	ถนนสุขุมวิท	\N	\N	5001	2562	106	2	3.18	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	7-9724-16849-94-5	\N	3	นภาพร	\N	ทองดี	2	1	0	0	1	ถนนนวมินทร์	\N	\N	5002	2566	102	2	2.78	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	6-8111-66039-17-2	\N	3	ณัฐนิชา	\N	สุขสันต์	2	1	0	0	9	ถนนบายพาส	\N	\N	5003	2562	106	1	3.51	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	7-8656-41224-26-1	\N	3	บุษยา	\N	สกุลดี	2	1	0	0	5	ถนนกาญจนาภิเษก	\N	\N	5005	2560	112	3	2.52	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	1-5493-57408-44-5	\N	1	ปัณณทัต	\N	สง่างาม	1	1	0	0	10	ถนนพหลโยธิน	\N	\N	5005	2558	421	2	3.14	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	1-8207-11162-69-1	\N	1	พิพัฒน์	\N	ดำรงค์	1	1	0	0	6	ถ.เอกชัย	\N	\N	5003	2560	112	1	2.89	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	6-2049-67729-33-5	\N	1	รชานนท์	\N	แสงสว่าง	1	1	0	0	5	ถนนเยาวราช	\N	\N	5005	2560	112	2	3.79	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	4-2875-95799-14-3	\N	2	อรณิชา	\N	ยิ้มแย้ม	2	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	5002	2557	422	3	3.31	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	3	10010002	6-9854-15863-86-4	\N	2	ปัณฑิตา	\N	แสงสว่าง	2	1	0	0	6	ถนนเพชรเกษม	\N	\N	5003	2560	112	1	3.36	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	6-7084-99262-63-2	\N	1	ธนพัฒน์	\N	มีสุข	1	1	0	0	7	ถนนวิภาวดีรังสิต	\N	\N	5001	2556	423	1	2.47	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	6-8711-48543-89-1	\N	1	ภูมิพัฒน์	\N	วิไลวรรณ	1	1	0	0	3	ถนนกลางเมือง	\N	\N	5005	2561	111	2	3.96	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	1	10010002	6-9368-76608-84-6	\N	1	ศิวกร	\N	รักษ์ไทย	1	1	0	0	4	ถนนบายพาส	\N	\N	5005	2560	112	1	3.22	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	2-4679-84108-74-9	\N	1	บุญยิ่ง	\N	สีดา	1	1	0	0	7	ถนนนวมินทร์	\N	\N	5002	2567	103	3	2.34	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	8-6192-45282-34-5	\N	1	คุณากร	\N	พรสวรรค์	1	1	0	0	4	ถนนช้างเผือก	\N	\N	5001	2556	423	2	3.32	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	2-4949-68328-62-6	\N	1	ชูเกียรติ	\N	เกียรติสกุล	1	1	0	0	2	ถนนมิตรภาพ	\N	\N	5002	2566	102	2	3.62	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	7-4764-84624-26-9	\N	1	ประพันธ์	\N	อ่อนน้อม	1	1	0	0	4	ถนนมาลัยแมน	\N	\N	5004	2562	106	1	2.9	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	3	10010002	7-7898-76194-28-8	\N	1	ไกรวุฒิ	\N	หอมหวาน	1	1	0	0	4	ถนนศรีนครินทร์	\N	\N	5003	2559	113	2	2.24	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	3	10010002	8-2654-26567-14-7	\N	2	พิมพ์ชนก	\N	ศรีสุข	2	1	0	0	1	ถนนราษฎร์บูรณะ	\N	\N	5004	2566	102	3	3.57	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	7-4955-48455-25-6	\N	1	ปรเมศวร์	\N	วิริยะ	1	1	0	0	6	ถนนเพชรเกษม	\N	\N	5005	2567	101	2	3.03	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	7-5739-72535-99-3	\N	1	วรากร	\N	ทั่วถึง	1	1	0	0	3	ถนนโชคชัย	\N	\N	5003	2561	111	2	3.34	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	8-7215-52000-66-3	\N	1	อภิวัฒน์	\N	สุขสบาย	1	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	5005	2556	423	2	3.35	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	7-5673-52310-59-6	\N	1	วิชญ์พล	\N	ขาวสะอาด	1	1	0	0	3	ถนนชัยพฤกษ์	\N	\N	5004	2567	101	1	3.35	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	6-2629-55527-46-3	\N	1	เอกพงษ์	\N	สีดา	1	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	5002	2566	102	3	2.92	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	3	10010002	2-4795-97350-45-3	\N	3	ศิริพร	\N	อินทร์ชัย	2	1	0	0	2	ถนนสาทร	\N	\N	5002	2556	423	2	3.98	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	1-9001-13378-57-4	\N	1	ภูมิพัฒน์	\N	คงพิทักษ์	1	1	0	0	5	ถนนอุดรดุษฎี	\N	\N	5001	2557	422	3	3.6	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	2-8281-66657-73-5	\N	2	ปิยนุช	\N	สุขสันต์	2	1	0	0	2	ถนนสรงประภา	\N	\N	5004	2562	106	1	3.43	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	3-9307-53953-45-8	\N	2	สุมาลี	\N	สุวรรณภูมิ	2	1	0	0	9	ถนนงามวงศ์วาน	\N	\N	5001	2567	101	3	2.61	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	1-1130-42232-27-7	\N	3	ปัณฑิตา	\N	จันทร์แก้ว	2	1	0	0	4	ถนนอ่อนนุช	\N	\N	5005	2556	423	1	3.68	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	2-9459-38074-10-7	\N	2	กาญจนา	\N	กิตติคุณ	2	1	0	0	2	ถ.บ้านโป่ง	\N	\N	5002	2558	421	2	2.26	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	7-4845-93586-54-8	\N	1	สมศักดิ์	\N	สมบูรณ์	1	1	0	0	9	ถนนศรีนครินทร์	\N	\N	5001	2562	106	3	2.53	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	6-9903-73040-47-2	\N	3	พรทิพย์	\N	เพียรดี	2	1	0	0	4	ถนนรามคำแหง	\N	\N	5004	2567	101	3	3.09	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	6-2860-55557-99-7	\N	3	สุนิสา	\N	วิไลวรรณ	2	1	0	0	3	ถ.เอกชัย	\N	\N	5002	2562	106	1	2.35	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	4-7701-17969-81-6	\N	3	จิตรลดา	\N	สุจริต	2	1	0	0	5	ถนนห้วยแก้ว	\N	\N	5002	2558	421	2	2.54	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	3	10010002	4-6567-93396-15-5	\N	3	จิราพร	\N	สกุลดี	2	1	0	0	8	ถนนมาลัยแมน	\N	\N	5004	2561	111	1	2.68	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	6-3117-89293-79-1	\N	1	สุทธิพงษ์	\N	เพ็งพา	1	1	0	0	1	ถนนบายพาส	\N	\N	5005	2557	422	3	2.22	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	1-9497-37585-56-9	\N	1	ชูเกียรติ	\N	วังขวา	1	1	0	0	4	ถนนราษฎร์บูรณะ	\N	\N	5003	2558	421	3	2.13	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	3	10010002	4-1223-14728-12-9	\N	2	จันทร์เพ็ญ	\N	พันธุ์ดี	2	1	0	0	2	ถนนโชคชัย	\N	\N	5002	2560	112	2	2.83	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	3	10010002	4-1553-45711-25-7	\N	2	ศิริพร	\N	เพ็งพา	2	1	0	0	7	ถนนสรงประภา	\N	\N	5003	2567	103	1	2.61	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	3-2565-87095-60-4	\N	2	กัญญาณัฐ	\N	ใจดี	2	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	5005	2566	102	1	2.52	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	8-7169-48173-64-2	\N	2	อัมพร	\N	ขาวสะอาด	2	1	0	0	4	ถนนมาลัยแมน	\N	\N	5003	2564	104	1	2.38	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	8-7449-58855-79-2	\N	3	กาญจนา	\N	สุดสวย	2	1	0	0	8	ถนนสีลม	\N	\N	5005	2564	104	1	2.89	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	2-6089-53572-28-2	\N	1	ธัชพล	\N	สง่างาม	1	1	0	0	2	ถนนประดิษฐ์มนูธรรม	\N	\N	5002	2563	105	2	2.95	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	8-9575-84270-39-1	\N	1	นรวิชญ์	\N	กิตติคุณ	1	1	0	0	8	ถนนเยาวราช	\N	\N	5005	2563	105	1	2.28	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	1	10010002	7-1091-45146-98-4	\N	3	สุดารัตน์	\N	สุขสันต์	2	1	0	0	9	ถ.บ้านโป่ง	\N	\N	5002	2567	103	2	3.44	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	2-2721-65797-99-2	\N	2	ชนิดา	\N	วิไลวรรณ	2	1	0	0	7	ถนนสรงประภา	\N	\N	5004	2562	106	3	3.11	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	2-1639-65598-73-3	\N	1	ดิศรณ์	\N	พรประเสริฐ	1	1	0	0	9	ถ.บ้านโป่ง	\N	\N	5001	2559	113	1	2.88	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	7-5820-98694-44-9	\N	1	เอกพงษ์	\N	ศักดิ์สิทธิ์	1	1	0	0	6	ถนนกลางเมือง	\N	\N	5004	2557	422	1	2.59	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	6-9509-89235-42-8	\N	1	อภิวัฒน์	\N	พันธุ์ดี	1	1	0	0	8	ถนนสาทร	\N	\N	5005	2567	101	3	3.93	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	3-3463-71668-18-1	\N	2	วันวิสา	\N	เพ็งพา	2	1	0	0	5	ถนนอ่อนนุช	\N	\N	5005	2556	423	1	2.64	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	8-3563-18751-54-9	\N	1	อนุชา	\N	จันทร์แก้ว	1	1	0	0	4	ถนนมิตรภาพ	\N	\N	5005	2567	103	2	2.37	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	6-7607-43390-81-9	\N	1	ชินดนัย	\N	นามมนตรี	1	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	5003	2559	113	3	3.46	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	3	10010002	2-3075-78461-85-7	\N	1	ชนะชัย	\N	สีดา	1	1	0	0	6	ถนนกาญจนาภิเษก	\N	\N	5002	2558	421	1	2.53	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	3-3348-31603-70-1	\N	2	สิริมา	\N	สุขสบาย	2	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	5002	2563	105	1	3.86	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	5-9198-25374-40-9	\N	1	ปรเมศวร์	\N	วิริยะ	1	1	0	0	7	ถนนบายพาส	\N	\N	5004	2566	102	3	3.21	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	5	10010002	4-3721-93069-45-3	\N	3	จันทร์เพ็ญ	\N	สุวรรณภูมิ	2	1	0	0	7	ถนนประดิษฐ์มนูธรรม	\N	\N	5003	2564	104	2	3.16	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	3-1414-57931-69-6	\N	3	ศิริพร	\N	สุจริต	2	1	0	0	7	ถนนสาทร	\N	\N	5001	2560	112	2	3.3	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	4-1091-86832-49-6	\N	1	วีรชัย	\N	เกียรติสกุล	1	1	0	0	2	ถนนกลางเมือง	\N	\N	5002	2564	104	1	3	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	8-7525-15756-99-5	\N	2	วาสนา	\N	คงพิทักษ์	2	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	5003	2563	105	3	2.55	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	2-1625-58435-13-3	\N	1	สมศักดิ์	\N	ลือชา	1	1	0	0	3	ถนนสรงประภา	\N	\N	5005	2566	102	2	2.76	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	1	10010002	1-6148-22776-79-5	\N	1	รชานนท์	\N	สุขสันต์	1	1	0	0	4	ถนนสุขุมวิท	\N	\N	5001	2559	113	2	3.27	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	5	10010002	1-7605-64575-95-1	\N	3	แสงดาว	\N	วังขวา	2	1	0	0	2	ถนนอ่อนนุช	\N	\N	5002	2567	103	3	3.9	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	4-9281-63641-32-1	\N	1	วรพล	\N	นามมนตรี	1	1	0	0	5	ถนนกาญจนาภิเษก	\N	\N	5001	2566	102	2	2.57	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	2-2904-21870-33-2	\N	3	สุภัสสรา	\N	บริบูรณ์	2	1	0	0	3	ถนนห้วยแก้ว	\N	\N	5005	2566	102	3	3.9	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	2-5042-50341-97-4	\N	1	ชูเกียรติ	\N	เพ็งพา	1	1	0	0	3	ถนนนิมมานเหมินท์	\N	\N	5001	2559	113	3	2.75	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	6-7782-39617-34-5	\N	1	วีรชัย	\N	วังขวา	1	1	0	0	4	ถนนศรีนครินทร์	\N	\N	5003	2561	111	2	2.45	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	6-9569-68939-90-3	\N	3	ปาณิสรา	\N	หอมหวาน	2	1	0	0	1	ถนนบายพาส	\N	\N	5001	2561	111	2	3.24	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	5-4398-54850-99-9	\N	1	ปิยังกูร	\N	ดำรงค์	1	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	5002	2562	106	2	3.29	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	3	10010002	1-2889-77768-94-3	\N	1	ธนพัฒน์	\N	สง่างาม	1	1	0	0	8	ถนนสรงประภา	\N	\N	5002	2560	112	1	2.94	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	1-6281-23711-90-6	\N	3	มาลัย	\N	เกียรติสกุล	2	1	0	0	1	ถนนราษฎร์บูรณะ	\N	\N	5005	2567	101	3	3.38	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	8-9958-34400-12-8	\N	3	กาญจนา	\N	ชัยมงคล	2	1	0	0	10	ถ.รัฐพัฒนา	\N	\N	5001	2567	103	2	2.75	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	6-8906-98939-61-5	\N	3	สุมาลี	\N	ลือชา	2	1	0	0	1	ถนนสีลม	\N	\N	5002	2564	104	3	2.87	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	3-9391-31808-48-9	\N	1	รชานนท์	\N	สกุลดี	1	1	0	0	4	ถนนสรงประภา	\N	\N	5003	2560	112	2	3.19	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	3-6670-70124-60-3	\N	1	บุญยิ่ง	\N	ชัยมงคล	1	1	0	0	8	ถนนพหลโยธิน	\N	\N	5001	2561	111	2	3.63	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	4-8152-21818-41-3	\N	1	ชินดนัย	\N	สมบูรณ์	1	1	0	0	9	ถนนกลางเมือง	\N	\N	5003	2563	105	1	2.37	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	7-4481-71906-95-7	\N	1	สุรชัย	\N	เพ็งพา	1	1	0	0	8	ถนนสุรวงศ์	\N	\N	5003	2563	105	2	3.1	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	5-7956-88241-60-9	\N	1	วีรชัย	\N	บุญมี	1	1	0	0	2	ถนนมิตรภาพ	\N	\N	5003	2560	112	2	3.55	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	6-9215-10208-88-7	\N	2	รุ่งอรุณ	\N	อินทร์ชัย	2	1	0	0	2	ถนนสีลม	\N	\N	5005	2564	104	1	2.86	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	6-7292-95726-33-7	\N	1	วุฒิพงษ์	\N	ดีสมัย	1	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	5001	2563	105	2	2.87	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	2-8617-20831-54-2	\N	3	นภาพร	\N	ทองดี	2	1	0	0	7	ถนนพหลโยธิน	\N	\N	5003	2563	105	1	2.33	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	1-8964-95697-95-7	\N	1	ณัฐวุฒิ	\N	บุญมี	1	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	5005	2566	102	2	3.53	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	5	10010002	8-6489-80126-56-2	\N	3	อัมพร	\N	ทั่วถึง	2	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	5001	2567	103	2	3.1	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	4-9436-90546-68-7	\N	2	แสงดาว	\N	รักษ์ไทย	2	1	0	0	1	ถ.รัฐพัฒนา	\N	\N	5001	2556	423	3	3.18	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	6-5134-65797-53-5	\N	2	ปัณฑิตา	\N	กิตติคุณ	2	1	0	0	1	ถนนนวมินทร์	\N	\N	5004	2567	103	1	3.8	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	1-2829-56824-14-9	\N	3	ธัญชนก	\N	สุวรรณภูมิ	2	1	0	0	7	ถนนสุรวงศ์	\N	\N	5004	2557	422	2	2.65	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	8-8063-46004-54-8	\N	1	ศุภณัฐ	\N	บุญรอด	1	1	0	0	10	ถนนสุรวงศ์	\N	\N	5001	2559	113	3	2.29	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	2-7257-77191-20-6	\N	2	ปัณฑิตา	\N	วิไลวรรณ	2	1	0	0	5	ถนนอุดรดุษฎี	\N	\N	5003	2558	421	1	3.22	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	4-5275-49741-88-9	\N	2	ณัฐนิชา	\N	ทั่วถึง	2	1	0	0	9	ถนนสุรวงศ์	\N	\N	5003	2558	421	2	3.93	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	3-5535-75740-95-1	\N	1	ประพันธ์	\N	ดำรงค์	1	1	0	0	10	ถนนสุดสาคร	\N	\N	5004	2559	113	2	2.55	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	7-3126-46014-44-8	\N	1	ณัฐวรรธน์	\N	พันธุ์ดี	1	1	0	0	10	ถนนห้วยแก้ว	\N	\N	5003	2566	102	2	2.81	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	3	10010002	5-8547-87059-63-6	\N	1	วิชญ์พล	\N	อินทร์ชัย	1	1	0	0	9	ถนนบายพาส	\N	\N	5001	2560	112	1	2.13	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	3-8568-75401-36-9	\N	2	กัญญา	\N	ชัยมงคล	2	1	0	0	3	ถนนบายพาส	\N	\N	5003	2558	421	2	3.65	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	6-2361-37204-77-6	\N	2	จิราพร	\N	เพียรดี	2	1	0	0	5	ถนนวิภาวดีรังสิต	\N	\N	5005	2556	423	3	2.97	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	5	10010002	6-8070-64446-12-5	\N	3	ลลิตา	\N	มณีรัตน์	2	1	0	0	9	ถ.บ้านโป่ง	\N	\N	5002	2557	422	3	2.33	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	2-2588-61871-37-4	\N	1	วีรชัย	\N	บุญรอด	1	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	5002	2561	111	3	3.91	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	4-7851-88544-45-6	\N	1	ดิศรณ์	\N	สง่างาม	1	1	0	0	6	ถนนเพชรเกษม	\N	\N	5004	2563	105	2	2.7	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	8-3571-33281-61-5	\N	3	วาสนา	\N	อินทร์ชัย	2	1	0	0	1	ถนนนวมินทร์	\N	\N	5004	2566	102	2	2.93	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	7-7852-63778-34-1	\N	3	ประภา	\N	อ่อนน้อม	2	1	0	0	10	ถนนสีลม	\N	\N	5002	2556	423	2	3.16	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	7-1374-52601-88-4	\N	1	ทักษิณ	\N	นิ่มนวล	1	1	0	0	3	ถ.เอกชัย	\N	\N	5005	2558	421	3	3.14	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	4-3644-70000-57-4	\N	1	ประพันธ์	\N	มณีรัตน์	1	1	0	0	3	ถ.เอกชัย	\N	\N	5005	2559	113	3	3.02	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	1	10010002	8-8523-42118-97-8	\N	1	ณัฐวุฒิ	\N	บุญมี	1	1	0	0	4	ถนนศรีนครินทร์	\N	\N	5003	2559	113	1	2.41	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	3	10010002	2-1112-14236-97-7	\N	2	วาสนา	\N	พรสวรรค์	2	1	0	0	9	ถ.เอกชัย	\N	\N	5005	2560	112	1	2.49	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	1	10010002	1-8184-73020-17-5	\N	3	ชลธิชา	\N	หอมหวาน	2	1	0	0	7	ถนนลาดพร้าว	\N	\N	5005	2562	106	3	3.55	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	1	10010002	2-3768-58033-62-6	\N	3	จิราพร	\N	สกุลดี	2	1	0	0	3	ถนนสุรวงศ์	\N	\N	5001	2567	101	1	3.77	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	8-5009-44078-53-5	\N	3	สิริมา	\N	จันทร์แก้ว	2	1	0	0	8	ถนนช้างเผือก	\N	\N	5003	2560	112	2	3.8	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	3-9548-47805-13-4	\N	3	ดวงใจ	\N	ดำรงค์	2	1	0	0	6	ถนนกลางเมือง	\N	\N	5003	2564	104	1	3.57	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	5-3530-26849-28-5	\N	2	สุดารัตน์	\N	ดำรงค์	2	1	0	0	7	ถนนเยาวราช	\N	\N	5003	2556	423	3	2.88	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	1-5250-57731-75-9	\N	1	ภูมิพัฒน์	\N	มงคล	1	1	0	0	7	ถ.เอกชัย	\N	\N	5002	2563	105	2	2.3	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	6-7192-73602-92-3	\N	1	สมชาย	\N	อ่อนน้อม	1	1	0	0	9	ถ.เอกชัย	\N	\N	5002	2562	106	3	2.63	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	4-4675-29672-45-2	\N	1	สุรชัย	\N	เจริญชัย	1	1	0	0	4	ถนนมิตรภาพ	\N	\N	5001	2559	113	2	2.45	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	1-7528-92103-22-6	\N	2	พรรษา	\N	สุขสันต์	2	1	0	0	9	ถนนงามวงศ์วาน	\N	\N	5005	2563	105	3	2.41	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	4-5195-33944-98-4	\N	2	กัญญา	\N	พรสวรรค์	2	1	0	0	4	ถ.รัฐพัฒนา	\N	\N	5001	2563	105	3	3.05	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	5	10010002	4-2043-27373-76-5	\N	1	กิตติภณ	\N	คงพิทักษ์	1	1	0	0	1	ถนนสาทร	\N	\N	5003	2564	104	2	2.36	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	1-6224-93087-19-4	\N	1	ปัณณทัต	\N	ชูศรี	1	1	0	0	8	ถนนรามคำแหง	\N	\N	5005	2560	112	2	2.2	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	5	10010002	8-5914-84623-11-7	\N	3	กัญญาณัฐ	\N	ดีสมัย	2	1	0	0	2	ถ.ประชาสามัคคี	\N	\N	5001	2561	111	3	2.59	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	7-5435-74566-90-3	\N	1	มานพ	\N	พรสวรรค์	1	1	0	0	6	ถนนโชคชัย	\N	\N	5005	2564	104	1	2.65	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	5-9242-50475-90-8	\N	3	วาสนา	\N	อ่อนน้อม	2	1	0	0	2	ถนนศรีนครินทร์	\N	\N	5003	2563	105	3	2.5	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	7-5991-22395-66-6	\N	3	พิมพ์ชนก	\N	วิริยะ	2	1	0	0	9	ถนนศรีนครินทร์	\N	\N	5004	2561	111	1	2.52	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	6-9690-71849-23-5	\N	1	ชูเกียรติ	\N	จันทร์แก้ว	1	1	0	0	10	ถนนสาทร	\N	\N	5002	2564	104	2	3.1	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	3-6335-77694-70-7	\N	1	ณัฐวุฒิ	\N	เพ็งพา	1	1	0	0	5	ถนนสีลม	\N	\N	5002	2559	113	1	3.7	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	3	10010002	6-8368-50372-64-7	\N	3	กาญจนา	\N	เกียรติสกุล	2	1	0	0	7	ถนนพหลโยธิน	\N	\N	5002	2558	421	2	3.45	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	4-4417-96776-42-5	\N	3	วรรณภา	\N	สุวรรณภูมิ	2	1	0	0	6	ถนนสุขุมวิท	\N	\N	5002	2562	106	2	2.04	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	4-9240-67685-45-2	\N	3	อัมพร	\N	วิไลวรรณ	2	1	0	0	2	ถนนสุรวงศ์	\N	\N	5005	2567	101	3	2.8	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	5	10010002	1-7390-73837-41-5	\N	1	ณัฐวุฒิ	\N	สีดา	1	1	0	0	10	ถนนบายพาส	\N	\N	5004	2560	112	2	3.9	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	3	10010002	5-2819-71845-27-2	\N	1	ชนะชัย	\N	แสงสว่าง	1	1	0	0	6	ถนนมาลัยแมน	\N	\N	5003	2559	113	3	2.74	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	8-5017-52970-83-9	\N	1	อภิวัฒน์	\N	ชูศรี	1	1	0	0	5	ถนนประดิษฐ์มนูธรรม	\N	\N	5003	2559	113	1	3.12	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	3	10010002	8-4519-34135-51-8	\N	2	ดวงใจ	\N	บุญมี	2	1	0	0	4	ถ.รัฐพัฒนา	\N	\N	5001	2561	111	2	3.83	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	1-3298-25622-92-7	\N	2	เกวลิน	\N	สุจริต	2	1	0	0	7	ถนนสุดสาคร	\N	\N	5003	2561	111	3	3.55	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	1-9261-52869-78-8	\N	2	วรรณภา	\N	วิริยะ	2	1	0	0	5	ถนนช้างเผือก	\N	\N	5003	2563	105	3	2.87	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	3-9413-21498-83-8	\N	1	เอกพงษ์	\N	ใจดี	1	1	0	0	10	ถนนอ่อนนุช	\N	\N	5005	2567	101	3	3.67	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	3-6413-19571-33-6	\N	1	ชูเกียรติ	\N	สุจริต	1	1	0	0	8	ถนนเจริญกรุง	\N	\N	5004	2558	421	2	2.9	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	1-1139-39521-51-7	\N	3	ณัฐนิชา	\N	ดำรงค์	2	1	0	0	3	ถนนเยาวราช	\N	\N	5003	2561	111	3	3.69	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	4-6810-85609-29-4	\N	1	มานพ	\N	สุจริต	1	1	0	0	3	ถนนสาทร	\N	\N	5003	2566	102	2	3.48	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	6-2134-52920-50-4	\N	2	ธัญชนก	\N	มณีรัตน์	2	1	0	0	4	ถนนอ่อนนุช	\N	\N	5005	2566	102	1	3.67	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	8-3017-59166-13-8	\N	3	รัตนาภรณ์	\N	นามมนตรี	2	1	0	0	4	ถนนบายพาส	\N	\N	5002	2558	421	2	2.05	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	2-2521-32950-74-9	\N	1	กวินท์	\N	มีสุข	1	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	5004	2567	101	1	3.66	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	3	10010002	7-4129-37568-21-9	\N	1	รัฐนนท์	\N	กิตติคุณ	1	1	0	0	6	ถ.เอกชัย	\N	\N	5005	2558	421	3	3.99	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	1	10010002	7-2639-56488-56-5	\N	2	วาสนา	\N	บริบูรณ์	2	1	0	0	2	ถนนอุดรดุษฎี	\N	\N	5001	2556	423	2	3.61	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	5-6296-15946-28-4	\N	2	พรทิพย์	\N	อ่อนน้อม	2	1	0	0	3	ถนนพหลโยธิน	\N	\N	5004	2557	422	1	3.9	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	4-5801-58719-89-7	\N	1	คุณากร	\N	รักษ์ไทย	1	1	0	0	3	ถนนมาลัยแมน	\N	\N	5002	2557	422	1	2.12	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	2-3660-13929-73-4	\N	1	ธนาธิป	\N	พรประเสริฐ	1	1	0	0	5	ถนนสุดสาคร	\N	\N	5002	2559	113	2	3.76	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	3	10010002	1-3364-63432-15-9	\N	3	ปาณิสรา	\N	มณีรัตน์	2	1	0	0	7	ถนนเจริญกรุง	\N	\N	5001	2563	105	1	3.78	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	2-2841-72349-69-7	\N	1	ดิศรณ์	\N	จันทร์แก้ว	1	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	5001	2567	103	1	2.37	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	5-3100-52320-94-9	\N	1	ไกรวุฒิ	\N	พรสวรรค์	1	1	0	0	6	ถนนเพชรเกษม	\N	\N	5001	2561	111	2	3.05	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	5	10010002	3-4695-96403-20-2	\N	2	ศิริพร	\N	บุญมี	2	1	0	0	7	ถนนวิภาวดีรังสิต	\N	\N	5002	2567	103	1	3.65	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	6-8571-97602-85-9	\N	1	ปัณณทัต	\N	อินทร์ชัย	1	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	5003	2560	112	3	3.32	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	1-7308-92821-16-4	\N	1	ณัฐวุฒิ	\N	สกุลดี	1	1	0	0	3	ถนนพหลโยธิน	\N	\N	5003	2563	105	3	3.47	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	8-8927-55075-34-7	\N	1	วสันต์	\N	ทองดี	1	1	0	0	8	ถนนสาทร	\N	\N	5002	2556	423	2	2.65	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	6-6525-34421-42-6	\N	3	เพ็ญพักตร์	\N	บุญรอด	2	1	0	0	8	ถนนประดิษฐ์มนูธรรม	\N	\N	5004	2563	105	3	2.56	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	5	10010002	6-7988-94186-13-9	\N	2	รุ่งอรุณ	\N	เพียรดี	2	1	0	0	3	ถนนเพชรเกษม	\N	\N	5003	2563	105	2	2.13	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	3-6695-50243-67-7	\N	1	เจษฎา	\N	สุขสันต์	1	1	0	0	9	ถนนบรมราชชนนี	\N	\N	5001	2559	113	3	3.43	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	4-1273-36041-55-9	\N	1	ธัชพล	\N	ปัญญาดี	1	1	0	0	10	ถนนชัยพฤกษ์	\N	\N	5005	2566	102	1	3.76	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	3-7135-30807-22-3	\N	1	ปิยังกูร	\N	เกียรติสกุล	1	1	0	0	10	ถนนสีลม	\N	\N	5005	2559	113	3	3.89	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	7-5857-61088-76-7	\N	1	ปิยังกูร	\N	นิ่มนวล	1	1	0	0	8	ถ.รัฐพัฒนา	\N	\N	5004	2556	423	2	2.1	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	3	10010002	5-4420-90362-86-2	\N	3	อรณิชา	\N	สุขสบาย	2	1	0	0	1	ถนนมาลัยแมน	\N	\N	5001	2567	101	3	3.33	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	7-7406-87518-34-4	\N	1	อภิวัฒน์	\N	ลือชา	1	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	5002	2558	421	2	3.57	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	3-4372-68114-28-5	\N	1	กันตภณ	\N	บุญมี	1	1	0	0	6	ถนนพหลโยธิน	\N	\N	5004	2560	112	3	3.48	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	4-8180-49167-25-9	\N	1	คุณากร	\N	ขาวสะอาด	1	1	0	0	10	ถ.รัฐพัฒนา	\N	\N	5005	2566	102	3	3.4	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	5-2848-92168-69-7	\N	1	วรากร	\N	งามดี	1	1	0	0	10	ถนนราษฎร์บูรณะ	\N	\N	5003	2558	421	1	2.76	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	6-4953-97151-73-7	\N	3	ประภา	\N	อินทร์ชัย	2	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	5005	2557	422	1	4	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	7-5116-56748-20-1	\N	1	ชูเกียรติ	\N	นามมนตรี	1	1	0	0	2	ถ.บ้านโป่ง	\N	\N	5003	2567	103	3	3.11	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	2-8993-83488-87-7	\N	1	มานพ	\N	กิตติคุณ	1	1	0	0	10	ถนนเจริญกรุง	\N	\N	5002	2564	104	2	3.4	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	4-6909-86037-96-7	\N	2	ปัณฑิตา	\N	ชูศรี	2	1	0	0	7	ถนนลาดพร้าว	\N	\N	5001	2556	423	1	2.23	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	5	10010002	7-8074-97696-13-4	\N	3	นวลจันทร์	\N	มงคล	2	1	0	0	10	ถนนศรีนครินทร์	\N	\N	5004	2567	101	3	2.56	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	3	10010002	8-5153-57000-97-6	\N	1	วสันต์	\N	ชัยมงคล	1	1	0	0	6	ถนนสุรวงศ์	\N	\N	5001	2560	112	2	3.6	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	6-7575-55683-32-8	\N	2	ลลิตา	\N	วิไลวรรณ	2	1	0	0	2	ถนนช้างเผือก	\N	\N	5004	2567	103	1	2.58	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	7-6126-91500-73-3	\N	2	เพ็ญพักตร์	\N	วิไลวรรณ	2	1	0	0	7	ถนนอ่อนนุช	\N	\N	5003	2557	422	3	2.18	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	3-6288-12087-24-4	\N	3	จันทร์เพ็ญ	\N	สุวรรณภูมิ	2	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	5003	2560	112	2	3.51	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	7-5315-29105-53-9	\N	2	ประภา	\N	ประสิทธิ์ผล	2	1	0	0	6	ถนนสุดสาคร	\N	\N	5005	2562	106	1	2.19	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	5	10010002	6-4683-68004-15-4	\N	1	วีรชัย	\N	จันทร์แก้ว	1	1	0	0	9	ถนนชัยพฤกษ์	\N	\N	5003	2566	102	3	3.96	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	2	10010002	4-3381-11627-47-4	\N	3	ณัฐนิชา	\N	อินทร์ชัย	2	1	0	0	1	ถ.เอกชัย	\N	\N	5002	2556	423	1	2.88	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	7-5284-57706-43-7	\N	2	สุนิสา	\N	รุ่งเรือง	2	1	0	0	6	ถนนกลางเมือง	\N	\N	5002	2564	104	3	2.92	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	4-9819-85885-26-2	\N	1	ณัฐวุฒิ	\N	บุญรอด	1	1	0	0	9	ถ.เอกชัย	\N	\N	5003	2562	106	3	2.27	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	1-8540-91108-66-8	\N	2	ภัทรวดี	\N	สีดา	2	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	5003	2562	106	1	2.93	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	6-8809-29382-18-6	\N	1	ดิศรณ์	\N	มณีรัตน์	1	1	0	0	2	ถนนกาญจนาภิเษก	\N	\N	5005	2561	111	3	3.37	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	3-7492-38207-94-8	\N	2	สุมาลี	\N	วังขวา	2	1	0	0	5	ถนนนวมินทร์	\N	\N	5005	2559	113	2	3.41	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	6-1111-89900-16-6	\N	2	เกวลิน	\N	ดำรงค์	2	1	0	0	10	ถนนรามคำแหง	\N	\N	5005	2562	106	1	3.53	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	4-5076-88843-32-3	\N	1	ทักษิณ	\N	ใจดี	1	1	0	0	1	ถ.บ้านโป่ง	\N	\N	5005	2559	113	3	2.32	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	4	10010002	7-7677-59976-99-8	\N	1	ชาตรี	\N	วงษ์สุวรรณ	1	1	0	0	3	ถนนช้างเผือก	\N	\N	5001	2563	105	3	3.4	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	5-9186-21892-33-5	\N	1	ชนะชัย	\N	ขาวสะอาด	1	1	0	0	7	ถนนอ่อนนุช	\N	\N	5003	2562	106	3	2.86	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	3	10010002	5-1334-89450-17-9	\N	1	สมชาย	\N	อ่อนน้อม	1	1	0	0	1	ถนนกลางเมือง	\N	\N	5001	2559	113	2	3.5	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	5-1453-84459-82-6	\N	1	ดิศรณ์	\N	สุขสบาย	1	1	0	0	2	ถนนศรีนครินทร์	\N	\N	5005	2567	103	1	2.79	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	6-2588-99545-29-6	\N	1	วสันต์	\N	นิ่มนวล	1	1	0	0	10	ถนนศรีนครินทร์	\N	\N	5004	2561	111	3	2.59	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	2-6106-48198-23-6	\N	2	จันทร์เพ็ญ	\N	วิริยะ	2	1	0	0	3	ถนนเจริญกรุง	\N	\N	5002	2561	111	1	3.32	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	6-8449-96309-80-7	\N	1	ชนะชัย	\N	กิตติคุณ	1	1	0	0	8	ถนนรามคำแหง	\N	\N	5002	2556	423	1	3.99	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	8-4085-62990-15-6	\N	1	ชาตรี	\N	พงษ์ไพร	1	1	0	0	1	ถ.เอกชัย	\N	\N	5003	2559	113	1	3.92	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	7-9951-94305-35-5	\N	1	คุณากร	\N	วงษ์สุวรรณ	1	1	0	0	6	ถนนสรงประภา	\N	\N	5003	2557	422	3	3.15	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	4	10010002	8-1390-74387-23-6	\N	2	ประภา	\N	พันธุ์ดี	2	1	0	0	9	ถ.เอกชัย	\N	\N	5004	2556	423	2	2.75	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	4-2461-50254-85-9	\N	3	สุดารัตน์	\N	ธนาคาร	2	1	0	0	3	ถนนห้วยแก้ว	\N	\N	5003	2559	113	3	3.66	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	3	10010002	1-8107-76633-77-3	\N	1	ปิยังกูร	\N	มณีรัตน์	1	1	0	0	9	ถนนกลางเมือง	\N	\N	5001	2556	423	2	2.38	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	2-4335-74916-36-1	\N	1	นรวิชญ์	\N	จันทร์แก้ว	1	1	0	0	1	ถนนบายพาส	\N	\N	5004	2559	113	1	3.42	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	6-3900-61107-39-6	\N	1	อนุชา	\N	ศรีสุข	1	1	0	0	7	ถนนลาดพร้าว	\N	\N	5003	2567	101	1	3.49	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	7-6074-36853-93-5	\N	1	อภิวัฒน์	\N	คงพิทักษ์	1	1	0	0	7	ถนนพหลโยธิน	\N	\N	5002	2564	104	3	2.66	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010002	7-1684-68868-26-4	\N	3	สุนิสา	\N	นามมนตรี	2	1	0	0	2	ถนนรามคำแหง	\N	\N	5002	2566	102	2	3.4	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	3-5202-99247-98-7	\N	1	ดิศรณ์	\N	ธนาคาร	1	1	0	0	5	ถนนนวมินทร์	\N	\N	5004	2557	422	1	3.07	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	8-4289-26661-76-1	\N	3	วิมลรัตน์	\N	จันทร์แก้ว	2	1	0	0	8	ถ.เอกชัย	\N	\N	5001	2557	422	1	3.9	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	2-4960-67140-88-6	\N	1	รัฐนนท์	\N	อินทร์ชัย	1	1	0	0	8	ถนนชัยพฤกษ์	\N	\N	5001	2557	422	1	2.17	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	2	10010002	1-1232-30016-53-5	\N	2	จิตรลดา	\N	เพียรดี	2	1	0	0	3	ถนนมิตรภาพ	\N	\N	5005	2566	102	1	3.59	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	2	10010002	4-4014-92210-34-6	\N	2	กุลธิดา	\N	ประสิทธิ์ผล	2	1	0	0	8	ถนนสุขุมวิท	\N	\N	5004	2561	111	2	3.11	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	3	10010002	6-1929-24596-97-2	\N	2	ชลธิชา	\N	คงพิทักษ์	2	1	0	0	7	ถนนเจริญกรุง	\N	\N	5005	2558	421	3	2.32	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010002	2-4828-10773-58-1	\N	1	ทักษิณ	\N	สีดา	1	1	0	0	10	ถนนรัตนาธิเบศร์	\N	\N	5002	2558	421	2	2.08	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	1	10010002	1-8805-84906-92-7	\N	2	ดรุณี	\N	มงคล	2	1	0	0	5	ถนนบายพาส	\N	\N	5002	2563	105	3	3.09	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	8-8850-30072-68-9	\N	2	วันวิสา	\N	สุจริต	2	1	0	0	6	ถนนสีลม	\N	\N	5004	2561	111	2	2.82	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	6-1343-66588-48-3	\N	1	ศิวกร	\N	ยิ้มแย้ม	1	1	0	0	1	ถ.รัฐพัฒนา	\N	\N	5002	2557	422	2	3.76	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	3	10010002	7-7844-70369-67-8	\N	2	จันทร์เพ็ญ	\N	ประสิทธิ์ผล	2	1	0	0	7	ถ.รัฐพัฒนา	\N	\N	5002	2560	112	1	3.88	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	4-4554-35030-82-4	\N	3	เกวลิน	\N	เพียรดี	2	1	0	0	10	ถนนกลางเมือง	\N	\N	5004	2566	102	3	3.29	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	2	10010002	2-9893-95490-67-5	\N	3	กัญญา	\N	เกียรติสกุล	2	1	0	0	10	ถนนมาลัยแมน	\N	\N	5003	2556	423	2	2.28	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	7-3954-68062-13-4	\N	1	ชินดนัย	\N	คงมั่น	1	1	0	0	7	ถนนศรีนครินทร์	\N	\N	5003	2558	421	1	3.32	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	5	10010002	6-8677-42204-26-8	\N	2	วันวิสา	\N	อ่อนน้อม	2	1	0	0	6	ถนนเจริญกรุง	\N	\N	5004	2567	103	1	2.47	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	1-6431-21789-50-6	\N	1	ณัฐวรรธน์	\N	จันทร์แก้ว	1	1	0	0	4	ถนนชัยพฤกษ์	\N	\N	5001	2567	103	1	2.22	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	8-8783-54383-32-5	\N	1	พิพัฒน์	\N	สุขสันต์	1	1	0	0	5	ถนนเพชรเกษม	\N	\N	5001	2560	112	3	3.82	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	1	10010002	7-3593-83618-80-8	\N	1	อภิวัฒน์	\N	เพ็งพา	1	1	0	0	5	ถนนสุรวงศ์	\N	\N	5004	2561	111	3	3.84	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	1	10010002	7-8746-59724-71-3	\N	1	บุญยิ่ง	\N	รักษ์ไทย	1	1	0	0	1	ถนนกลางเมือง	\N	\N	5004	2562	106	1	2.27	10	เชียงใหม่	เมืองเชียงใหม่	ช้างมอย
2569	1	4	10010002	6-2392-58492-18-3	\N	2	มาลัย	\N	มีสุข	2	1	0	0	3	ถนนนิมมานเหมินท์	\N	\N	5001	2557	422	3	3.13	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	3	10010002	2-6811-89011-73-1	\N	2	นันทพร	\N	ธนาคาร	2	1	0	0	10	ถนนมาลัยแมน	\N	\N	5002	2557	422	2	3.42	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	2	10010002	1-9021-51755-31-1	\N	1	ประพันธ์	\N	มงคล	1	1	0	0	4	ถนนนิมมานเหมินท์	\N	\N	5003	2564	104	3	2.7	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	3	10010002	8-2314-53636-80-1	\N	3	ลลิตา	\N	ชัยมงคล	2	1	0	0	3	ถนนพหลโยธิน	\N	\N	5001	2567	103	3	3.99	10	เชียงใหม่	เมืองเชียงใหม่	ศรีภูมิ
2569	1	4	10010002	5-7146-53992-56-9	\N	1	พิพัฒน์	\N	เจริญชัย	1	1	0	0	7	ถนนมาลัยแมน	\N	\N	5002	2563	105	2	2.78	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	5	10010002	5-2364-68965-95-2	\N	3	อรณิชา	\N	สีดา	2	1	0	0	6	ถนนโชคชัย	\N	\N	5003	2561	111	1	3.08	10	เชียงใหม่	เมืองเชียงใหม่	หายยา
2569	1	1	10010002	6-2064-30185-83-4	\N	1	ภูมิพัฒน์	\N	พรสวรรค์	1	1	0	0	2	ถนนงามวงศ์วาน	\N	\N	5002	2558	421	1	2.15	10	เชียงใหม่	เมืองเชียงใหม่	พระสิงห์
2569	1	4	10010003	4-4279-84738-48-4	\N	2	สิริมา	\N	ศรีสุข	2	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	4001	2561	111	1	3.54	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	1-6077-11620-37-3	\N	2	พรรษา	\N	อ่อนน้อม	2	1	0	0	6	ถนนสาทร	\N	\N	4002	2557	422	2	2.43	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	3-9055-72937-81-5	\N	3	สุมาลี	\N	สีดา	2	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	4003	2567	101	2	3.4	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	5-1000-49773-66-7	\N	1	ธนภัทร	\N	มงคล	1	1	0	0	10	ถนนราษฎร์บูรณะ	\N	\N	4001	2566	102	1	3.79	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	6-2246-46697-63-1	\N	1	ณัฐพล	\N	เกียรติสกุล	1	1	0	0	5	ถนนลาดพร้าว	\N	\N	4002	2566	102	2	3.61	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	1-8807-32882-11-2	\N	1	พิพัฒน์	\N	รักษ์ไทย	1	1	0	0	2	ถนนสุรวงศ์	\N	\N	4003	2556	423	1	2.24	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	3-4530-18540-60-7	\N	3	มาลัย	\N	นามมนตรี	2	1	0	0	1	ถนนลาดพร้าว	\N	\N	4001	2556	423	2	2.13	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	1	10010003	2-5601-46905-71-4	\N	3	อัมพร	\N	รุ่งเรือง	2	1	0	0	5	ถนนสุขุมวิท	\N	\N	4002	2561	111	3	3.82	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	7-9004-40345-16-5	\N	2	กุลธิดา	\N	สุดสวย	2	1	0	0	6	ถนนบรมราชชนนี	\N	\N	4004	2564	104	3	2.28	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	3	10010003	3-6254-93796-54-7	\N	3	พรรษา	\N	บุญรอด	2	1	0	0	3	ถนนสุดสาคร	\N	\N	4002	2567	101	3	3.85	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	8-9884-63454-56-7	\N	3	พรรษา	\N	สง่างาม	2	1	0	0	2	ถนนเยาวราช	\N	\N	4003	2558	421	3	3.5	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	3-1700-55017-74-3	\N	1	ชาตรี	\N	สุวรรณภูมิ	1	1	0	0	10	ถนนช้างเผือก	\N	\N	4004	2556	423	3	3.72	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	4	10010003	2-9214-81302-15-9	\N	1	สุทธิพงษ์	\N	บุญมี	1	1	0	0	2	ถนนพหลโยธิน	\N	\N	4002	2562	106	1	3.65	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	6-9985-61768-76-7	\N	2	กัญญา	\N	ทั่วถึง	2	1	0	0	4	ถนนมิตรภาพ	\N	\N	4002	2563	105	2	2.23	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	4-1009-76127-23-8	\N	2	ดวงใจ	\N	อินทร์ชัย	2	1	0	0	3	ถนนงามวงศ์วาน	\N	\N	4004	2566	102	3	3.84	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	4-1385-12125-13-5	\N	3	นลินทิพย์	\N	ขาวสะอาด	2	1	0	0	2	ถนนสาทร	\N	\N	4002	2557	422	3	2.19	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	2-7912-56860-94-7	\N	1	ชูเกียรติ	\N	สุจริต	1	1	0	0	1	ถนนนิมมานเหมินท์	\N	\N	4001	2559	113	2	2.91	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	8-1686-99013-72-1	\N	3	นภาพร	\N	คงมั่น	2	1	0	0	8	ถนนห้วยแก้ว	\N	\N	4003	2556	423	3	3.18	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	7-6751-99764-72-1	\N	3	ณัฐนิชา	\N	สุดสวย	2	1	0	0	7	ถนนลาดพร้าว	\N	\N	4004	2557	422	3	3.54	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	2-8449-59787-53-4	\N	2	ประภา	\N	ลือชา	2	1	0	0	10	ถ.เอกชัย	\N	\N	4003	2556	423	1	2.17	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	2-1168-99630-26-1	\N	1	ณัฐวุฒิ	\N	ขาวสะอาด	1	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	4005	2561	111	1	3.3	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	1-5148-86763-25-9	\N	1	ธนพัฒน์	\N	สมบูรณ์	1	1	0	0	8	ถนนศรีนครินทร์	\N	\N	4004	2564	104	3	3.22	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	3-2258-36099-71-8	\N	2	วิมลรัตน์	\N	ทองดี	2	1	0	0	4	ถนนพหลโยธิน	\N	\N	4003	2562	106	2	2.85	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	1	10010003	6-9083-39980-66-2	\N	2	วันวิสา	\N	สง่างาม	2	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	4004	2567	103	2	2.53	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	6-8044-12691-77-6	\N	1	ปรเมศวร์	\N	ทั่วถึง	1	1	0	0	9	ถนนเพชรเกษม	\N	\N	4005	2562	106	1	2.88	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	2-2429-44442-95-6	\N	2	กาญจนา	\N	นามมนตรี	2	1	0	0	8	ถนนสุดสาคร	\N	\N	4004	2559	113	3	2.84	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	4-8308-96489-79-6	\N	1	ปรเมศวร์	\N	ศรีสุข	1	1	0	0	9	ถนนเยาวราช	\N	\N	4001	2560	112	1	3.14	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	1	10010003	4-3414-49366-27-7	\N	2	ชลธิชา	\N	ชูศรี	2	1	0	0	1	ถนนกลางเมือง	\N	\N	4004	2563	105	3	2.08	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	1-5969-27964-50-4	\N	1	ธนพัฒน์	\N	ธนาคาร	1	1	0	0	8	ถนนสาทร	\N	\N	4001	2559	113	3	3.33	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	7-9870-19295-28-3	\N	1	บุญยิ่ง	\N	ลือชา	1	1	0	0	9	ถนนชัยพฤกษ์	\N	\N	4004	2566	102	1	2.65	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	7-6926-39536-43-7	\N	1	สุรชัย	\N	วิริยะ	1	1	0	0	1	ถนนอุดรดุษฎี	\N	\N	4001	2556	423	1	2.49	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	1	10010003	6-7402-68959-87-4	\N	1	ณัฐวุฒิ	\N	สง่างาม	1	1	0	0	3	ถ.เอกชัย	\N	\N	4004	2567	101	1	3.51	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	2-8090-88619-13-7	\N	2	นวลจันทร์	\N	พงษ์ไพร	2	1	0	0	2	ถนนประดิษฐ์มนูธรรม	\N	\N	4005	2560	112	2	2.99	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	5-8610-95218-53-5	\N	1	สมศักดิ์	\N	สง่างาม	1	1	0	0	9	ถนนห้วยแก้ว	\N	\N	4002	2556	423	2	2.55	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	3-8689-54181-21-8	\N	3	กาญจนา	\N	เจริญชัย	2	1	0	0	6	ถนนนวมินทร์	\N	\N	4005	2563	105	3	3.21	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	4-6129-52488-40-4	\N	1	สิรภพ	\N	ยิ้มแย้ม	1	1	0	0	6	ถนนนิมมานเหมินท์	\N	\N	4003	2557	422	2	3.19	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	3	10010003	4-3281-48668-34-6	\N	1	ชาตรี	\N	พรประเสริฐ	1	1	0	0	9	ถนนประดิษฐ์มนูธรรม	\N	\N	4004	2558	421	2	3.2	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	5-5047-36965-86-6	\N	3	สิริมา	\N	ชูศรี	2	1	0	0	3	ถ.บ้านโป่ง	\N	\N	4005	2562	106	1	3.45	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	3-5173-89427-19-5	\N	3	นลินทิพย์	\N	ลือชา	2	1	0	0	2	ถนนบายพาส	\N	\N	4003	2567	103	2	3.17	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	5-9374-84377-63-4	\N	2	พิมพ์ชนก	\N	ดีสมัย	2	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	4003	2558	421	2	3.87	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	2-3289-33737-25-6	\N	3	สมหญิง	\N	คงพิทักษ์	2	1	0	0	1	ถนนลาดพร้าว	\N	\N	4001	2561	111	2	2.9	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	2-7934-36855-15-1	\N	1	กันตภณ	\N	จันทร์แก้ว	1	1	0	0	1	ถนนรามคำแหง	\N	\N	4005	2558	421	2	2.25	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	5-6792-40980-29-1	\N	3	เพ็ญพักตร์	\N	พันธุ์ดี	2	1	0	0	9	ถนนห้วยแก้ว	\N	\N	4004	2558	421	1	2.44	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	3-2493-84873-88-5	\N	1	ดิศรณ์	\N	พรสวรรค์	1	1	0	0	8	ถนนรามคำแหง	\N	\N	4004	2566	102	3	3.42	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	3-3843-38880-45-2	\N	1	ปัณณทัต	\N	มงคล	1	1	0	0	1	ถนนสุรวงศ์	\N	\N	4004	2561	111	1	3.03	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	7-8276-68002-29-7	\N	3	อัมพร	\N	มีสุข	2	1	0	0	10	ถนนบายพาส	\N	\N	4002	2559	113	1	3.69	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	6-6276-12715-73-9	\N	1	ปิยังกูร	\N	งามดี	1	1	0	0	10	ถนนบายพาส	\N	\N	4003	2556	423	3	2.98	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	1	10010003	7-3758-62953-36-4	\N	2	จิตรลดา	\N	เกียรติสกุล	2	1	0	0	6	ถนนมิตรภาพ	\N	\N	4002	2563	105	3	3.67	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	8-1397-99979-82-4	\N	2	อภิญญา	\N	วังขวา	2	1	0	0	2	ถ.ประชาสามัคคี	\N	\N	4003	2559	113	2	3.2	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	3	10010003	7-8296-65592-21-7	\N	1	วีรชัย	\N	ดำรงค์	1	1	0	0	5	ถนนมิตรภาพ	\N	\N	4003	2567	101	2	2.53	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	4-1594-59996-56-1	\N	1	กันตภณ	\N	เกียรติสกุล	1	1	0	0	4	ถนนบรมราชชนนี	\N	\N	4003	2557	422	1	2.34	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	1	10010003	5-8423-29533-47-3	\N	1	ศุภณัฐ	\N	นิ่มนวล	1	1	0	0	7	ถนนกาญจนาภิเษก	\N	\N	4005	2559	113	2	2.16	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	2-1854-85053-93-3	\N	1	วิชญ์พล	\N	รุ่งเรือง	1	1	0	0	5	ถนนประดิษฐ์มนูธรรม	\N	\N	4003	2558	421	3	2.13	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	2	10010003	2-2663-45264-32-9	\N	2	อัมพร	\N	พงษ์ไพร	2	1	0	0	2	ถ.รัฐพัฒนา	\N	\N	4001	2561	111	3	3.48	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	6-3814-45695-75-1	\N	2	สุมาลี	\N	รักษ์ไทย	2	1	0	0	9	ถนนโชคชัย	\N	\N	4005	2559	113	1	3.57	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	3-4963-89818-57-5	\N	1	ธัชพล	\N	บุญมี	1	1	0	0	8	ถนนสุรวงศ์	\N	\N	4002	2556	423	2	2.31	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	1-2098-59469-27-1	\N	2	ธัญชนก	\N	วังขวา	2	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	4002	2567	101	3	3.41	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	6-7638-42955-77-7	\N	3	แสงดาว	\N	ศักดิ์สิทธิ์	2	1	0	0	3	ถนนโชคชัย	\N	\N	4005	2564	104	3	3.04	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	2-7756-60144-58-5	\N	2	อรณิชา	\N	คงมั่น	2	1	0	0	6	ถนนสุขุมวิท	\N	\N	4001	2561	111	2	3.72	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	3-8371-87388-27-5	\N	2	ศิริพร	\N	งามดี	2	1	0	0	7	ถนนสุรวงศ์	\N	\N	4001	2559	113	2	3.55	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	8-7087-36829-69-3	\N	1	ภูมิพัฒน์	\N	อินทร์ชัย	1	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	4004	2556	423	2	2.8	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	3	10010003	8-7333-95646-65-2	\N	1	อภิวัฒน์	\N	ยิ้มแย้ม	1	1	0	0	10	ถนนวิภาวดีรังสิต	\N	\N	4001	2561	111	2	2.3	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	1	10010003	5-9302-31750-11-2	\N	3	วาสนา	\N	ทองดี	2	1	0	0	3	ถนนประดิษฐ์มนูธรรม	\N	\N	4004	2559	113	2	2.66	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	7-6472-90337-68-6	\N	2	วรรณภา	\N	วิริยะ	2	1	0	0	10	ถนนห้วยแก้ว	\N	\N	4002	2560	112	2	2.05	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	8-8100-77367-14-9	\N	2	ทิพย์สุดา	\N	พรสวรรค์	2	1	0	0	10	ถนนโชคชัย	\N	\N	4005	2566	102	1	3.83	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	5-3358-28639-35-2	\N	1	อภิวัฒน์	\N	ปัญญาดี	1	1	0	0	10	ถนนบายพาส	\N	\N	4004	2566	102	3	3.57	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	3	10010003	4-7854-84618-34-7	\N	2	จิราพร	\N	ทองดี	2	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	4001	2567	103	1	3.92	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	1	10010003	2-4589-71381-31-8	\N	2	สิริมา	\N	ใจดี	2	1	0	0	2	ถนนบรมราชชนนี	\N	\N	4002	2567	103	2	3.51	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	6-6349-79036-29-9	\N	3	เกวลิน	\N	มงคล	2	1	0	0	5	ถนนสุรวงศ์	\N	\N	4004	2559	113	3	3.12	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	3	10010003	5-9173-63046-16-5	\N	1	ภูมิพัฒน์	\N	สกุลดี	1	1	0	0	5	ถนนเพชรเกษม	\N	\N	4004	2560	112	2	3.88	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	2-9883-76301-56-7	\N	1	นพรัตน์	\N	อินทร์ชัย	1	1	0	0	7	ถนนมาลัยแมน	\N	\N	4002	2566	102	2	3.86	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	2-6143-17458-65-7	\N	2	สุดารัตน์	\N	พงษ์ไพร	2	1	0	0	7	ถนนชัยพฤกษ์	\N	\N	4002	2559	113	2	3.9	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	8-7493-87125-37-7	\N	2	กาญจนา	\N	ชัยมงคล	2	1	0	0	7	ถนนสุรวงศ์	\N	\N	4003	2566	102	2	2.85	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	2-2649-20760-20-1	\N	2	นลินทิพย์	\N	ชัยมงคล	2	1	0	0	3	ถนนนวมินทร์	\N	\N	4002	2567	103	2	3.27	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	1-3186-48197-56-6	\N	2	ศิริพร	\N	ธนาคาร	2	1	0	0	10	ถนนบรมราชชนนี	\N	\N	4002	2567	101	1	3.21	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	2-1647-90525-10-4	\N	1	ดิศรณ์	\N	ขาวสะอาด	1	1	0	0	3	ถนนสุดสาคร	\N	\N	4003	2567	101	1	3.99	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	5-3271-18512-69-5	\N	3	ภัทรวดี	\N	ชูศรี	2	1	0	0	3	ถนนโชคชัย	\N	\N	4003	2560	112	3	2.14	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	3	10010003	6-3667-71952-67-6	\N	1	วุฒิพงษ์	\N	คงพิทักษ์	1	1	0	0	9	ถนนนิมมานเหมินท์	\N	\N	4002	2562	106	1	2.79	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	4-8557-29493-29-1	\N	3	นวลจันทร์	\N	รุ่งเรือง	2	1	0	0	2	ถนนรัตนาธิเบศร์	\N	\N	4002	2559	113	3	2.65	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	5-6451-51936-84-4	\N	1	อภิวัฒน์	\N	จันทร์แก้ว	1	1	0	0	8	ถนนอุดรดุษฎี	\N	\N	4004	2567	103	1	3.5	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	4	10010003	3-7402-35098-54-2	\N	3	สุภัสสรา	\N	วังขวา	2	1	0	0	1	ถนนลาดพร้าว	\N	\N	4002	2558	421	3	2.07	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	6-8366-27419-51-7	\N	2	นภาพร	\N	ปัญญาดี	2	1	0	0	6	ถนนศรีนครินทร์	\N	\N	4004	2556	423	3	3.93	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	6-3427-15508-27-4	\N	1	ดิศรณ์	\N	หอมหวาน	1	1	0	0	9	ถ.บ้านโป่ง	\N	\N	4004	2567	103	2	3.78	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	6-7111-54194-10-2	\N	2	กุลธิดา	\N	รุ่งเรือง	2	1	0	0	8	ถนนโชคชัย	\N	\N	4001	2562	106	3	2.72	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	4-8126-15167-68-9	\N	1	นรวิชญ์	\N	รักษ์ไทย	1	1	0	0	5	ถนนนวมินทร์	\N	\N	4003	2562	106	2	3.06	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	2-8774-64689-69-4	\N	3	ปัณฑิตา	\N	ชัยมงคล	2	1	0	0	6	ถนนสีลม	\N	\N	4001	2561	111	3	3.33	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	5-7468-44782-10-9	\N	3	ปาณิสรา	\N	อ่อนน้อม	2	1	0	0	4	ถนนลาดพร้าว	\N	\N	4001	2562	106	3	3.81	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	1	10010003	2-5483-80157-79-7	\N	1	กวินท์	\N	พงษ์ไพร	1	1	0	0	1	ถนนโชคชัย	\N	\N	4004	2567	103	2	2.29	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	5-2898-40780-59-9	\N	2	จิตรลดา	\N	กิตติคุณ	2	1	0	0	6	ถนนศรีนครินทร์	\N	\N	4005	2562	106	3	3.32	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	8-1338-23036-26-5	\N	1	ธนภัทร	\N	สุจริต	1	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	4004	2560	112	2	3.29	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	5-6070-81082-98-9	\N	2	สุนิสา	\N	สกุลดี	2	1	0	0	2	ถนนงามวงศ์วาน	\N	\N	4002	2558	421	2	2.2	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	5-3932-24859-67-6	\N	1	รัฐนนท์	\N	มงคล	1	1	0	0	2	ถนนโชคชัย	\N	\N	4001	2567	103	1	3.6	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	2-6787-33120-59-4	\N	2	วาสนา	\N	ลือชา	2	1	0	0	9	ถนนเยาวราช	\N	\N	4005	2559	113	1	2.71	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	3-9553-80098-34-8	\N	1	ทักษิณ	\N	พรสวรรค์	1	1	0	0	6	ถนนสุขุมวิท	\N	\N	4001	2563	105	1	2.29	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	8-2096-39720-94-8	\N	3	นภาพร	\N	จันทร์แก้ว	2	1	0	0	9	ถ.รัฐพัฒนา	\N	\N	4005	2567	101	1	2.75	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	6-1280-97107-57-6	\N	3	ชนิดา	\N	ดีสมัย	2	1	0	0	7	ถนนพหลโยธิน	\N	\N	4001	2563	105	2	2.38	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	2-3224-72053-73-9	\N	2	พรรษา	\N	บุญมี	2	1	0	0	9	ถนนช้างเผือก	\N	\N	4001	2567	103	3	3.21	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	7-5807-15103-23-1	\N	1	ทักษิณ	\N	พรสวรรค์	1	1	0	0	5	ถนนสรงประภา	\N	\N	4001	2557	422	1	2.62	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	6-2230-75311-49-5	\N	2	นภาพร	\N	นามมนตรี	2	1	0	0	7	ถนนสุขุมวิท	\N	\N	4003	2560	112	1	3.95	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	1	10010003	2-6939-24860-22-5	\N	1	ศิวกร	\N	วิไลวรรณ	1	1	0	0	6	ถนนห้วยแก้ว	\N	\N	4002	2557	422	1	3.86	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	5-6103-82116-79-2	\N	1	ธนาธิป	\N	ดำรงค์	1	1	0	0	9	ถนนนวมินทร์	\N	\N	4002	2557	422	1	2.46	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	7-2523-96231-52-5	\N	3	กัญญา	\N	จันทร์แก้ว	2	1	0	0	1	ถนนสรงประภา	\N	\N	4004	2567	101	2	3.88	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	6-7651-81036-23-5	\N	1	ชนะชัย	\N	ชูศรี	1	1	0	0	3	ถนนประดิษฐ์มนูธรรม	\N	\N	4001	2567	103	2	2.28	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	2-1275-71645-37-3	\N	1	ศุภณัฐ	\N	ชัยมงคล	1	1	0	0	3	ถนนโชคชัย	\N	\N	4002	2564	104	3	3.85	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	4-9071-81770-40-1	\N	1	รชานนท์	\N	สุขสบาย	1	1	0	0	7	ถนนสาทร	\N	\N	4005	2558	421	3	3.59	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	5-5413-42640-88-2	\N	3	กุลธิดา	\N	สุวรรณภูมิ	2	1	0	0	7	ถนนเยาวราช	\N	\N	4002	2562	106	3	2.82	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	3-4020-93993-84-2	\N	2	พิมพ์ชนก	\N	ประสิทธิ์ผล	2	1	0	0	4	ถนนสรงประภา	\N	\N	4005	2564	104	3	2.66	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	4-5530-24760-83-1	\N	1	วิชญ์พล	\N	พงษ์ไพร	1	1	0	0	4	ถนนรามคำแหง	\N	\N	4001	2559	113	3	2.79	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	2-7041-52613-62-7	\N	1	รชานนท์	\N	จันทร์แก้ว	1	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	4003	2560	112	2	2.29	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	2	10010003	4-9026-74082-45-7	\N	2	รุ่งอรุณ	\N	มงคล	2	1	0	0	1	ถนนเยาวราช	\N	\N	4002	2559	113	2	2.71	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	5-4339-64185-24-5	\N	1	ภัคพล	\N	บริบูรณ์	1	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	4002	2567	101	1	3.62	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	8-6699-49740-92-4	\N	3	ธัญชนก	\N	สง่างาม	2	1	0	0	8	ถนนอ่อนนุช	\N	\N	4001	2560	112	3	2.13	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	3-1280-40726-92-8	\N	3	กาญจนา	\N	นามมนตรี	2	1	0	0	7	ถนนสีลม	\N	\N	4002	2558	421	1	2.88	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	5-9462-50660-61-1	\N	1	รัฐนนท์	\N	นามมนตรี	1	1	0	0	2	ถนนเพชรเกษม	\N	\N	4003	2563	105	2	3.38	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	3-9143-79248-10-3	\N	1	ศิวกร	\N	หอมหวาน	1	1	0	0	1	ถนนห้วยแก้ว	\N	\N	4002	2566	102	3	3.36	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	5-7960-42921-99-5	\N	3	ดรุณี	\N	สุขสบาย	2	1	0	0	10	ถนนอ่อนนุช	\N	\N	4004	2564	104	1	2.4	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	4	10010003	4-6320-16003-53-6	\N	3	รุ่งอรุณ	\N	จันทร์แก้ว	2	1	0	0	8	ถนนสุรวงศ์	\N	\N	4004	2559	113	3	2.39	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	3-4789-63835-15-4	\N	2	ศิริพร	\N	สกุลดี	2	1	0	0	8	ถนนมาลัยแมน	\N	\N	4005	2559	113	3	2.15	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	4-4579-58611-22-1	\N	1	ชนะชัย	\N	สุจริต	1	1	0	0	5	ถนนพหลโยธิน	\N	\N	4005	2563	105	3	2.27	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	4-2946-22256-42-9	\N	3	สุภัสสรา	\N	อ่อนน้อม	2	1	0	0	4	ถนนลาดพร้าว	\N	\N	4005	2563	105	1	2.19	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	4-7747-53351-22-2	\N	3	ดวงใจ	\N	บุญรอด	2	1	0	0	9	ถนนสีลม	\N	\N	4002	2562	106	2	3.63	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	3-1440-22780-90-1	\N	3	พิมพ์ชนก	\N	สุดสวย	2	1	0	0	5	ถนนอ่อนนุช	\N	\N	4003	2559	113	2	3.11	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	2	10010003	4-3172-48666-68-1	\N	1	ดิศรณ์	\N	อินทร์ชัย	1	1	0	0	8	ถนนสีลม	\N	\N	4001	2556	423	1	3.65	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	5-8074-30175-98-2	\N	1	กิตติภณ	\N	ศรีสุข	1	1	0	0	3	ถ.เอกชัย	\N	\N	4002	2562	106	3	3.51	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	7-2778-21118-30-4	\N	2	พิมพ์ชนก	\N	เกียรติสกุล	2	1	0	0	2	ถนนชัยพฤกษ์	\N	\N	4001	2566	102	1	3.53	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	6-8422-30630-86-9	\N	3	ภัทรวดี	\N	อินทร์ชัย	2	1	0	0	10	ถนนสาทร	\N	\N	4002	2563	105	3	3.04	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	4-1328-35725-61-5	\N	2	อัมพร	\N	นิ่มนวล	2	1	0	0	7	ถนนนวมินทร์	\N	\N	4004	2556	423	2	2.52	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	2-8853-61721-93-3	\N	2	กัญญาณัฐ	\N	ธนาคาร	2	1	0	0	1	ถนนเจริญกรุง	\N	\N	4002	2558	421	1	3.47	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	2-4956-80648-80-2	\N	1	ปิยังกูร	\N	อินทร์ชัย	1	1	0	0	6	ถนนเจริญกรุง	\N	\N	4002	2560	112	1	3.02	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	1-8007-74291-36-3	\N	1	สิรภพ	\N	หอมหวาน	1	1	0	0	4	ถนนบรมราชชนนี	\N	\N	4003	2562	106	1	3.66	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	2-6273-70410-31-5	\N	1	ทักษิณ	\N	มีสุข	1	1	0	0	6	ถนนสุขุมวิท	\N	\N	4001	2564	104	3	3.34	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	1	10010003	6-3702-93498-84-2	\N	1	ทัศนัย	\N	สุขสบาย	1	1	0	0	2	ถนนอ่อนนุช	\N	\N	4001	2563	105	3	2.06	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	1-3453-56312-50-7	\N	3	ภัทรวดี	\N	ธนาคาร	2	1	0	0	2	ถนนโชคชัย	\N	\N	4005	2558	421	1	3.57	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	8-5705-74374-76-2	\N	3	ประภา	\N	หอมหวาน	2	1	0	0	3	ถนนศรีนครินทร์	\N	\N	4002	2556	423	3	3.63	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	8-1430-15786-86-1	\N	2	วาสนา	\N	วิไลวรรณ	2	1	0	0	1	ถนนเยาวราช	\N	\N	4004	2560	112	1	3.01	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010004	7-8419-13772-71-3	\N	2	จิราพร	\N	ใจดี	2	1	0	0	2	ถ.เอกชัย	\N	\N	1001	2559	113	3	2.94	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010003	5-9684-29655-61-7	\N	1	วีรชัย	\N	สุวรรณภูมิ	1	1	0	0	10	ถนนรามคำแหง	\N	\N	4003	2564	104	2	3.5	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	6-1802-57999-49-3	\N	1	รชานนท์	\N	รักษ์ไทย	1	1	0	0	10	ถนนบายพาส	\N	\N	4003	2562	106	1	3.98	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	4-7720-88918-88-9	\N	1	นพรัตน์	\N	วังขวา	1	1	0	0	8	ถนนมิตรภาพ	\N	\N	4001	2567	103	1	2.93	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	5-1769-26044-60-5	\N	1	ชูเกียรติ	\N	นิ่มนวล	1	1	0	0	9	ถนนรามคำแหง	\N	\N	4005	2567	103	1	2.32	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	8-5079-77589-34-7	\N	1	สิรภพ	\N	ยิ้มแย้ม	1	1	0	0	4	ถนนเจริญกรุง	\N	\N	4003	2563	105	3	3.9	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	2	10010003	7-5835-32396-76-5	\N	1	ธัชพล	\N	นามมนตรี	1	1	0	0	7	ถนนนิมมานเหมินท์	\N	\N	4002	2566	102	3	2.6	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	7-4504-23643-49-5	\N	1	ภูมิพัฒน์	\N	พงษ์ไพร	1	1	0	0	2	ถ.รัฐพัฒนา	\N	\N	4004	2561	111	2	3.5	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	6-5761-15546-33-7	\N	1	วีรชัย	\N	พันธุ์ดี	1	1	0	0	4	ถนนกลางเมือง	\N	\N	4004	2562	106	2	3.89	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	7-6041-63895-45-5	\N	2	บุษยา	\N	พันธุ์ดี	2	1	0	0	9	ถนนเจริญกรุง	\N	\N	4002	2562	106	3	2.17	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	3-5512-53457-27-8	\N	1	ชูเกียรติ	\N	อินทร์ชัย	1	1	0	0	10	ถนนรัตนาธิเบศร์	\N	\N	4001	2561	111	1	3.2	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	4-4423-56538-34-9	\N	3	ปัณฑิตา	\N	สุจริต	2	1	0	0	5	ถนนห้วยแก้ว	\N	\N	4001	2563	105	1	2.41	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	8-9621-71138-25-9	\N	1	ธัชพล	\N	สีดา	1	1	0	0	1	ถนนอ่อนนุช	\N	\N	4002	2558	421	1	2.18	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	6-4698-15139-62-1	\N	1	มานพ	\N	วงษ์สุวรรณ	1	1	0	0	2	ถนนบรมราชชนนี	\N	\N	4002	2561	111	1	2.44	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	1-1174-34225-36-1	\N	3	ประภา	\N	เจริญชัย	2	1	0	0	1	ถนนเพชรเกษม	\N	\N	4001	2567	103	3	3.75	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	4-7181-53758-70-8	\N	2	สุนิสา	\N	ศักดิ์สิทธิ์	2	1	0	0	5	ถนนวิภาวดีรังสิต	\N	\N	4002	2563	105	3	3.85	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	6-6665-27553-17-2	\N	1	วรพล	\N	รุ่งเรือง	1	1	0	0	5	ถนนงามวงศ์วาน	\N	\N	4001	2567	103	3	2.58	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	4-4790-62035-77-8	\N	1	คุณากร	\N	ยิ้มแย้ม	1	1	0	0	6	ถนนสุขุมวิท	\N	\N	4005	2566	102	1	3.31	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	4-9287-29383-19-4	\N	1	ทัศนัย	\N	รุ่งเรือง	1	1	0	0	8	ถนนกาญจนาภิเษก	\N	\N	4002	2564	104	3	2.48	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	5-3130-78115-78-7	\N	3	เกวลิน	\N	ใจดี	2	1	0	0	1	ถนนกลางเมือง	\N	\N	4001	2557	422	1	3.39	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	7-8133-16076-76-2	\N	1	ชูเกียรติ	\N	ธนาคาร	1	1	0	0	2	ถนนสรงประภา	\N	\N	4003	2562	106	2	3.87	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	7-2448-13574-59-3	\N	2	ณัฐนิชา	\N	ดีสมัย	2	1	0	0	8	ถนนงามวงศ์วาน	\N	\N	4001	2566	102	1	3.04	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	6-1852-66333-75-9	\N	2	วันวิสา	\N	จันทร์แก้ว	2	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	4002	2557	422	2	3.79	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	3-4454-78746-43-5	\N	1	วุฒิพงษ์	\N	ยิ้มแย้ม	1	1	0	0	1	ถนนรามคำแหง	\N	\N	4004	2559	113	3	3.29	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	6-5889-41119-71-9	\N	1	พิพัฒน์	\N	ศักดิ์สิทธิ์	1	1	0	0	9	ถนนสรงประภา	\N	\N	4001	2561	111	2	3.6	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	2-7071-69183-98-1	\N	2	ปัณฑิตา	\N	อินทร์ชัย	2	1	0	0	10	ถนนรัตนาธิเบศร์	\N	\N	4003	2561	111	3	2.42	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	3	10010003	1-8423-43455-84-3	\N	2	ดรุณี	\N	พรสวรรค์	2	1	0	0	7	ถนนมาลัยแมน	\N	\N	4003	2557	422	3	2.36	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	8-2468-78447-47-3	\N	3	รุ่งอรุณ	\N	สุขสันต์	2	1	0	0	9	ถนนกลางเมือง	\N	\N	4005	2557	422	3	3.49	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	5-4185-32953-34-2	\N	2	สมหญิง	\N	รักษ์ไทย	2	1	0	0	3	ถนนสีลม	\N	\N	4003	2567	101	1	2.94	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	1-8749-30316-60-2	\N	3	นันทพร	\N	ประสิทธิ์ผล	2	1	0	0	8	ถนนมาลัยแมน	\N	\N	4005	2563	105	1	2.82	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	4-9519-89525-38-6	\N	1	ชัยชนะ	\N	มีสุข	1	1	0	0	10	ถนนกลางเมือง	\N	\N	4002	2567	101	2	3.34	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	6-7676-96977-25-3	\N	1	คุณากร	\N	บุญมี	1	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	4005	2561	111	2	3.69	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	7-5358-22254-80-7	\N	2	ณัฐนิชา	\N	ประสิทธิ์ผล	2	1	0	0	10	ถนนบายพาส	\N	\N	4005	2562	106	3	3.35	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	7-2609-98081-97-3	\N	2	สุนิสา	\N	สุขสันต์	2	1	0	0	4	ถนนเจริญกรุง	\N	\N	4002	2558	421	3	2.96	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	7-9871-29523-40-5	\N	3	ดรุณี	\N	งามดี	2	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	4001	2561	111	1	3.6	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	7-7400-61024-18-1	\N	1	ภูมิพัฒน์	\N	สุขสันต์	1	1	0	0	2	ถนนบายพาส	\N	\N	4002	2560	112	1	2	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	1-1785-18679-58-9	\N	1	วรากร	\N	วงษ์สุวรรณ	1	1	0	0	1	ถนนกาญจนาภิเษก	\N	\N	4002	2563	105	2	3.65	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	8-7681-33224-90-9	\N	1	ศิวกร	\N	ยิ้มแย้ม	1	1	0	0	4	ถ.ประชาสามัคคี	\N	\N	4005	2567	103	3	2.78	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	1-9114-67756-66-5	\N	2	สมหญิง	\N	แสงสว่าง	2	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	4003	2561	111	3	2.7	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	3-6645-12550-81-2	\N	1	สมศักดิ์	\N	มีสุข	1	1	0	0	8	ถ.เอกชัย	\N	\N	4002	2567	103	2	3.41	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	5-2100-35594-35-4	\N	2	วรรณภา	\N	ดำรงค์	2	1	0	0	8	ถนนสีลม	\N	\N	4005	2567	101	2	2.53	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	7-2781-71235-79-2	\N	1	ปรเมศวร์	\N	วิไลวรรณ	1	1	0	0	8	ถนนพหลโยธิน	\N	\N	4003	2567	101	1	3.02	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	1	10010003	7-2845-38687-64-4	\N	1	ดิศรณ์	\N	สุจริต	1	1	0	0	9	ถนนห้วยแก้ว	\N	\N	4001	2560	112	3	2.33	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	4-4575-68653-19-9	\N	1	เจษฎา	\N	กิตติคุณ	1	1	0	0	5	ถนนนิมมานเหมินท์	\N	\N	4005	2563	105	2	2.75	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	7-5817-76881-15-2	\N	2	มาลัย	\N	สีดา	2	1	0	0	7	ถนนกาญจนาภิเษก	\N	\N	4002	2558	421	2	2.1	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	2-3322-70713-73-9	\N	2	วรรณภา	\N	มีสุข	2	1	0	0	3	ถนนศรีนครินทร์	\N	\N	4002	2559	113	1	2.8	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	3-2676-92348-34-5	\N	1	ธนภัทร	\N	สุขสันต์	1	1	0	0	9	ถนนมาลัยแมน	\N	\N	4002	2567	103	2	3.81	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	8-4831-65839-39-9	\N	1	สุทธิพงษ์	\N	บุญรอด	1	1	0	0	4	ถนนรามคำแหง	\N	\N	4003	2563	105	3	3.37	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	8-1375-74595-99-9	\N	1	ปิยังกูร	\N	สุจริต	1	1	0	0	7	ถนนสุดสาคร	\N	\N	4003	2564	104	1	2.81	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	7-9491-29207-11-6	\N	1	เจษฎา	\N	ลือชา	1	1	0	0	1	ถนนบายพาส	\N	\N	4001	2556	423	2	2.47	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	6-3608-21296-60-6	\N	1	ศุภณัฐ	\N	เพียรดี	1	1	0	0	1	ถนนช้างเผือก	\N	\N	4002	2557	422	1	3.26	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	3-2191-84792-27-6	\N	3	ภัทรวดี	\N	ประสิทธิ์ผล	2	1	0	0	10	ถนนสุดสาคร	\N	\N	4005	2559	113	3	2.15	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	7-9877-47854-79-1	\N	2	ประภา	\N	ศักดิ์สิทธิ์	2	1	0	0	3	ถนนสรงประภา	\N	\N	4005	2557	422	3	2.54	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	7-5108-76500-47-3	\N	1	ชาตรี	\N	พรสวรรค์	1	1	0	0	5	ถนนช้างเผือก	\N	\N	4001	2560	112	3	3.46	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	8-1586-95830-66-2	\N	1	ชัยชนะ	\N	วงษ์สุวรรณ	1	1	0	0	6	ถนนศรีนครินทร์	\N	\N	4003	2564	104	2	3.33	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	3-1429-90685-67-5	\N	1	ปิยังกูร	\N	ประสิทธิ์ผล	1	1	0	0	7	ถนนงามวงศ์วาน	\N	\N	4004	2562	106	2	2.39	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	4	10010003	7-9879-29649-89-7	\N	1	วรพล	\N	ยิ้มแย้ม	1	1	0	0	9	ถ.บ้านโป่ง	\N	\N	4004	2564	104	3	3.16	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	1-9718-51714-97-9	\N	1	ปรเมศวร์	\N	วิไลวรรณ	1	1	0	0	1	ถนนสุดสาคร	\N	\N	4005	2561	111	1	3.09	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	1-6904-61138-58-6	\N	1	ณัฐวรรธน์	\N	ยิ้มแย้ม	1	1	0	0	8	ถนนลาดพร้าว	\N	\N	4002	2563	105	1	3.39	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	6-7136-45169-42-3	\N	1	ณัฐวรรธน์	\N	ศรีสุข	1	1	0	0	9	ถนนสุดสาคร	\N	\N	4002	2560	112	3	2.35	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	4-3180-99591-78-5	\N	3	มาลัย	\N	ดีสมัย	2	1	0	0	7	ถนนสีลม	\N	\N	4002	2558	421	3	2.59	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	2-6371-34458-78-6	\N	1	ปิยังกูร	\N	ดำรงค์	1	1	0	0	8	ถนนศรีนครินทร์	\N	\N	4001	2563	105	2	2.33	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	4-6625-79434-87-6	\N	2	นภาพร	\N	ดำรงค์	2	1	0	0	2	ถนนสีลม	\N	\N	4002	2567	101	3	2.83	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	8-9502-44452-59-9	\N	1	นพรัตน์	\N	วังขวา	1	1	0	0	6	ถนนสุขุมวิท	\N	\N	4004	2563	105	2	2.05	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	3	10010003	5-2965-98529-75-2	\N	3	ประภา	\N	สง่างาม	2	1	0	0	2	ถ.เอกชัย	\N	\N	4003	2567	103	1	2.21	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	3	10010003	1-2409-57739-36-7	\N	2	รัตนาภรณ์	\N	ดีสมัย	2	1	0	0	5	ถนนบรมราชชนนี	\N	\N	4005	2560	112	3	2.47	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	3-6998-91183-37-7	\N	3	วิมลรัตน์	\N	จันทร์แก้ว	2	1	0	0	8	ถนนเจริญกรุง	\N	\N	4003	2560	112	1	2.21	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	5-3452-94320-23-5	\N	1	ปัณณทัต	\N	พรสวรรค์	1	1	0	0	2	ถนนลาดพร้าว	\N	\N	4004	2567	101	2	2.57	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	8-1985-89307-26-8	\N	3	ธัญชนก	\N	เจริญชัย	2	1	0	0	1	ถนนกาญจนาภิเษก	\N	\N	4005	2566	102	1	3.54	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	6-7589-31337-27-6	\N	2	อรณิชา	\N	มงคล	2	1	0	0	9	ถนนอุดรดุษฎี	\N	\N	4005	2558	421	3	3.71	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	8-9829-67960-45-5	\N	3	วรรณภา	\N	สง่างาม	2	1	0	0	3	ถนนสรงประภา	\N	\N	4005	2556	423	2	3.58	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	7-6959-51592-88-5	\N	3	จันทร์เพ็ญ	\N	วิริยะ	2	1	0	0	3	ถนนโชคชัย	\N	\N	4003	2566	102	3	3.45	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	1	10010003	6-1416-27842-10-1	\N	1	พิพัฒน์	\N	นิ่มนวล	1	1	0	0	1	ถนนชัยพฤกษ์	\N	\N	4001	2564	104	3	2.97	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	1	10010003	2-6340-51599-18-4	\N	2	ทิพย์สุดา	\N	ชูศรี	2	1	0	0	1	ถนนห้วยแก้ว	\N	\N	4002	2556	423	1	2.26	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	2-5651-49749-46-9	\N	2	กาญจนา	\N	พรประเสริฐ	2	1	0	0	9	ถนนบายพาส	\N	\N	4002	2558	421	3	3.48	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	8-5795-94298-62-3	\N	3	มาลัย	\N	รักษ์ไทย	2	1	0	0	1	ถนนสรงประภา	\N	\N	4004	2557	422	2	2.9	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	3-9902-23875-27-4	\N	2	วาสนา	\N	เกียรติสกุล	2	1	0	0	2	ถนนสรงประภา	\N	\N	4003	2567	103	1	3.15	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	3	10010003	7-1132-21776-76-4	\N	1	ไกรวุฒิ	\N	รักษ์ไทย	1	1	0	0	7	ถนนเยาวราช	\N	\N	4001	2557	422	3	2.19	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	3-8727-62956-76-2	\N	2	รัตนาภรณ์	\N	วังขวา	2	1	0	0	8	ถนนศรีนครินทร์	\N	\N	4005	2564	104	2	2.24	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	6-5352-73417-27-7	\N	1	สมชาย	\N	ลือชา	1	1	0	0	3	ถนนลาดพร้าว	\N	\N	4004	2561	111	2	3.54	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	4	10010003	2-7430-16959-80-3	\N	2	นันทพร	\N	วิริยะ	2	1	0	0	8	ถนนรามคำแหง	\N	\N	4004	2566	102	3	3.33	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	4-4049-13836-51-3	\N	2	ธัญชนก	\N	บริบูรณ์	2	1	0	0	3	ถนนชัยพฤกษ์	\N	\N	4002	2560	112	2	3.57	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	6-2234-93932-48-4	\N	1	เอกพงษ์	\N	รุ่งเรือง	1	1	0	0	9	ถนนประดิษฐ์มนูธรรม	\N	\N	4002	2563	105	3	2.85	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	4-6246-82868-49-5	\N	1	ปัณณทัต	\N	เพ็งพา	1	1	0	0	7	ถนนรามคำแหง	\N	\N	4003	2560	112	3	3.93	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	2	10010003	5-5049-12563-83-6	\N	3	สุมาลี	\N	ทั่วถึง	2	1	0	0	5	ถนนเยาวราช	\N	\N	4004	2562	106	1	3.62	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	3-3856-67690-18-3	\N	2	เพ็ญพักตร์	\N	สมบูรณ์	2	1	0	0	1	ถนนช้างเผือก	\N	\N	4004	2559	113	3	2.88	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	4-9033-52844-27-9	\N	1	บุญยิ่ง	\N	คงพิทักษ์	1	1	0	0	9	ถนนสุรวงศ์	\N	\N	4004	2561	111	2	3.49	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	1-9978-34699-32-1	\N	1	อภิวัฒน์	\N	มณีรัตน์	1	1	0	0	1	ถนนเยาวราช	\N	\N	4001	2557	422	2	2.79	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	4-7098-97470-75-6	\N	3	จิตรลดา	\N	พรประเสริฐ	2	1	0	0	3	ถนนสุรวงศ์	\N	\N	4005	2557	422	3	2.88	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	7-2343-85060-83-6	\N	2	วรรณภา	\N	ดีสมัย	2	1	0	0	2	ถ.รัฐพัฒนา	\N	\N	4001	2556	423	2	2.47	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	2-1374-29557-92-3	\N	1	สมชาย	\N	สุขสันต์	1	1	0	0	10	ถนนมิตรภาพ	\N	\N	4002	2564	104	3	3.23	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	4-1928-90226-35-1	\N	1	ศุภณัฐ	\N	ขาวสะอาด	1	1	0	0	10	ถนนมาลัยแมน	\N	\N	4002	2559	113	2	3.31	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	2-3378-62142-16-3	\N	2	กัญญาณัฐ	\N	สุจริต	2	1	0	0	3	ถนนรามคำแหง	\N	\N	4005	2566	102	1	3.41	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	3-1876-25095-87-2	\N	1	ดิศรณ์	\N	ศรีสุข	1	1	0	0	2	ถนนรามคำแหง	\N	\N	4004	2561	111	2	3.55	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	1-8315-27824-53-9	\N	2	จิราพร	\N	บุญมี	2	1	0	0	8	ถนนสุรวงศ์	\N	\N	4002	2566	102	1	3.43	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	7-7230-54212-36-9	\N	1	ทักษิณ	\N	ทั่วถึง	1	1	0	0	1	ถนนศรีนครินทร์	\N	\N	4002	2567	101	2	3.36	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	5-3885-23167-21-5	\N	3	นวลจันทร์	\N	สง่างาม	2	1	0	0	1	ถนนประดิษฐ์มนูธรรม	\N	\N	4005	2559	113	1	3.53	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	3-3459-88161-46-7	\N	2	สมหญิง	\N	ชัยมงคล	2	1	0	0	3	ถนนสุขุมวิท	\N	\N	4001	2567	101	3	2.99	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	2-1020-38130-95-6	\N	1	อนุชา	\N	มงคล	1	1	0	0	3	ถ.บ้านโป่ง	\N	\N	4003	2558	421	3	2.76	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	4-7944-57056-80-6	\N	1	ชูเกียรติ	\N	จันทร์แก้ว	1	1	0	0	9	ถนนกลางเมือง	\N	\N	4002	2557	422	1	2.28	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	3-1420-28460-71-1	\N	2	สุดารัตน์	\N	คงมั่น	2	1	0	0	7	ถนนรามคำแหง	\N	\N	4001	2559	113	1	3.78	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	3-2007-68079-20-7	\N	2	เพ็ญพักตร์	\N	ลือชา	2	1	0	0	7	ถนนสุขุมวิท	\N	\N	4002	2560	112	2	2.56	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	2-6609-51869-43-3	\N	2	พรทิพย์	\N	บุญมี	2	1	0	0	1	ถนนสีลม	\N	\N	4003	2556	423	3	3.89	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	1	10010003	7-9132-83980-91-8	\N	2	ปัณฑิตา	\N	แสงสว่าง	2	1	0	0	6	ถนนอุดรดุษฎี	\N	\N	4001	2567	103	3	2.85	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	6-7094-47361-64-3	\N	2	เพ็ญพักตร์	\N	เกียรติสกุล	2	1	0	0	4	ถนนเยาวราช	\N	\N	4004	2567	101	3	3.67	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	4	10010003	1-1973-25533-75-2	\N	2	ภัทรวดี	\N	สุขสันต์	2	1	0	0	1	ถนนสาทร	\N	\N	4003	2562	106	2	2.01	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	7-5524-21793-72-3	\N	1	เอกพงษ์	\N	ธนาคาร	1	1	0	0	7	ถนนเจริญกรุง	\N	\N	4004	2563	105	1	2.2	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	8-2759-29415-85-1	\N	1	ปิยังกูร	\N	สุขสบาย	1	1	0	0	2	ถนนช้างเผือก	\N	\N	4005	2567	101	3	3.51	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	2-5038-17062-69-4	\N	1	เจษฎา	\N	วงษ์สุวรรณ	1	1	0	0	6	ถนนบรมราชชนนี	\N	\N	4002	2563	105	1	2.82	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	7-3866-24969-35-1	\N	1	ศิวกร	\N	เกียรติสกุล	1	1	0	0	1	ถนนอุดรดุษฎี	\N	\N	4005	2567	101	2	2.95	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	7-5157-75034-13-4	\N	1	สมชาย	\N	บุญรอด	1	1	0	0	2	ถนนประดิษฐ์มนูธรรม	\N	\N	4005	2567	101	2	3.14	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	8-5165-67340-60-7	\N	1	ชาตรี	\N	ดีสมัย	1	1	0	0	3	ถนนบรมราชชนนี	\N	\N	4002	2564	104	2	2.48	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	1-1525-17547-44-7	\N	2	มาลัย	\N	พรประเสริฐ	2	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	4002	2566	102	3	3.78	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	1-8322-87137-72-8	\N	1	พิพัฒน์	\N	ชัยมงคล	1	1	0	0	2	ถนนเยาวราช	\N	\N	4005	2557	422	1	3.59	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	2-5416-85257-10-6	\N	1	ภูมิพัฒน์	\N	ทั่วถึง	1	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	4003	2562	106	1	3.09	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	5-9141-61773-87-9	\N	2	ธัญชนก	\N	หอมหวาน	2	1	0	0	8	ถนนสีลม	\N	\N	4005	2559	113	3	2.08	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	7-7262-89034-81-5	\N	1	ชินดนัย	\N	บริบูรณ์	1	1	0	0	2	ถนนมาลัยแมน	\N	\N	4005	2557	422	3	2.24	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	5-5067-40578-32-6	\N	2	ภัทรวดี	\N	คงมั่น	2	1	0	0	7	ถนนศรีนครินทร์	\N	\N	4004	2562	106	1	2.97	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	2-8308-11921-18-5	\N	1	เอกพงษ์	\N	สุดสวย	1	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	4005	2567	101	3	2.93	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	3-2731-21668-62-1	\N	1	ภูมิพัฒน์	\N	คงมั่น	1	1	0	0	3	ถนนสุขุมวิท	\N	\N	4004	2559	113	3	2.92	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	8-3401-24674-20-8	\N	2	ภัทรวดี	\N	พงษ์ไพร	2	1	0	0	1	ถนนนวมินทร์	\N	\N	4003	2560	112	3	3.03	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	5-9767-28119-30-2	\N	2	รุ่งอรุณ	\N	ปัญญาดี	2	1	0	0	8	ถนนมิตรภาพ	\N	\N	4001	2558	421	2	3.79	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	3-2011-13367-43-9	\N	1	สุทธิพงษ์	\N	มีสุข	1	1	0	0	1	ถนนมาลัยแมน	\N	\N	4005	2564	104	2	3.88	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	2-5907-88077-61-2	\N	3	ชนิดา	\N	เพียรดี	2	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	4001	2567	103	1	2.88	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	3-8591-61393-84-8	\N	3	แสงดาว	\N	ธนาคาร	2	1	0	0	1	ถนนกาญจนาภิเษก	\N	\N	4002	2556	423	3	2.85	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	2-7938-24744-55-7	\N	1	มานพ	\N	สุวรรณภูมิ	1	1	0	0	1	ถ.บ้านโป่ง	\N	\N	4002	2556	423	2	3.81	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	7-6800-24025-68-7	\N	1	ธนาธิป	\N	กิตติคุณ	1	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	4003	2560	112	3	2.45	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	4-5338-90190-64-1	\N	1	ไกรวุฒิ	\N	รุ่งเรือง	1	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	4003	2567	101	2	3.08	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	2	10010003	7-3332-30946-55-4	\N	2	นันทพร	\N	มีสุข	2	1	0	0	7	ถนนกาญจนาภิเษก	\N	\N	4001	2562	106	3	2.68	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	4-1673-67135-27-5	\N	1	ธนภัทร	\N	วิริยะ	1	1	0	0	7	ถ.เอกชัย	\N	\N	4005	2556	423	2	3.07	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	1-2038-21689-48-2	\N	1	ทัศนัย	\N	พรประเสริฐ	1	1	0	0	4	ถนนรามคำแหง	\N	\N	4004	2563	105	3	2.14	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	2-4811-37963-70-7	\N	1	สมชาย	\N	เพียรดี	1	1	0	0	1	ถนนช้างเผือก	\N	\N	4005	2561	111	1	3.49	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	7-6446-12874-31-6	\N	1	ปัณณทัต	\N	ทองดี	1	1	0	0	5	ถนนนิมมานเหมินท์	\N	\N	4003	2556	423	3	3.02	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	1	10010003	1-4166-47899-45-1	\N	3	นันทพร	\N	ศรีสุข	2	1	0	0	10	ถนนมาลัยแมน	\N	\N	4005	2559	113	2	2.64	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	5-9818-85135-79-1	\N	3	ชลธิชา	\N	งามดี	2	1	0	0	9	ถนนนวมินทร์	\N	\N	4004	2560	112	3	2.25	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	8-5437-64224-76-2	\N	1	ธัชพล	\N	บริบูรณ์	1	1	0	0	4	ถนนห้วยแก้ว	\N	\N	4005	2558	421	1	2.54	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	4-7485-91073-80-8	\N	1	ธัชพล	\N	ยิ้มแย้ม	1	1	0	0	5	ถนนโชคชัย	\N	\N	4004	2567	103	3	2.96	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	3	10010003	6-1807-24502-25-3	\N	3	ดรุณี	\N	สุดสวย	2	1	0	0	10	ถนนศรีนครินทร์	\N	\N	4001	2567	103	2	3.26	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	7-1728-56040-24-2	\N	1	ณัฐวรรธน์	\N	สง่างาม	1	1	0	0	8	ถนนบรมราชชนนี	\N	\N	4004	2566	102	1	3.55	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	4-7901-51207-41-7	\N	2	แสงดาว	\N	อินทร์ชัย	2	1	0	0	3	ถนนเพชรเกษม	\N	\N	4005	2562	106	3	3.62	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	1-5933-27810-48-9	\N	3	ชนิดา	\N	คงพิทักษ์	2	1	0	0	10	ถนนเยาวราช	\N	\N	4001	2556	423	2	2.02	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	7-8067-75208-62-1	\N	1	ณัฐพล	\N	พันธุ์ดี	1	1	0	0	6	ถนนอุดรดุษฎี	\N	\N	4004	2567	103	3	3.76	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	3	10010003	8-8259-54553-78-1	\N	2	รัตนาภรณ์	\N	ปัญญาดี	2	1	0	0	10	ถ.ประชาสามัคคี	\N	\N	4003	2557	422	2	3.73	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	4-7054-43828-61-7	\N	2	ชนิดา	\N	ดีสมัย	2	1	0	0	3	ถนนศรีนครินทร์	\N	\N	4005	2564	104	1	2.97	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	6-4750-17038-11-7	\N	3	เกวลิน	\N	แสงสว่าง	2	1	0	0	3	ถนนศรีนครินทร์	\N	\N	4001	2561	111	3	2.8	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	8-8765-50713-61-3	\N	1	ธนาธิป	\N	รักษ์ไทย	1	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	4003	2558	421	2	2.86	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	3	10010003	2-7103-75976-42-9	\N	2	ณัฐนิชา	\N	วงษ์สุวรรณ	2	1	0	0	9	ถนนบายพาส	\N	\N	4002	2564	104	3	3.97	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	7-8883-74819-81-3	\N	1	ธนภัทร	\N	งามดี	1	1	0	0	4	ถนนบรมราชชนนี	\N	\N	4005	2564	104	1	3.05	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	5-8309-27682-62-5	\N	1	สุทธิพงษ์	\N	คงพิทักษ์	1	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	4003	2562	106	1	3.86	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	2	10010003	5-4748-72747-53-4	\N	1	อภิวัฒน์	\N	สีดา	1	1	0	0	7	ถนนมิตรภาพ	\N	\N	4001	2558	421	1	2.41	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	5-9422-32915-49-3	\N	2	ประภา	\N	บริบูรณ์	2	1	0	0	2	ถนนประดิษฐ์มนูธรรม	\N	\N	4005	2566	102	3	2.75	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	7-5169-50042-93-6	\N	1	ธนพัฒน์	\N	วิไลวรรณ	1	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	4003	2561	111	2	2.28	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	1	10010003	3-8331-47416-78-8	\N	2	วันวิสา	\N	ดีสมัย	2	1	0	0	10	ถนนบรมราชชนนี	\N	\N	4001	2556	423	1	3.89	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	3-9016-32245-13-4	\N	3	ลลิตา	\N	งามดี	2	1	0	0	9	ถนนนวมินทร์	\N	\N	4002	2558	421	3	2.59	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	1-2102-89526-59-4	\N	2	แสงดาว	\N	ปัญญาดี	2	1	0	0	1	ถนนเยาวราช	\N	\N	4001	2567	103	2	3.49	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	3-5370-91805-39-6	\N	2	จันทร์เพ็ญ	\N	ทองดี	2	1	0	0	4	ถนนนิมมานเหมินท์	\N	\N	4004	2564	104	1	2.78	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	7-8217-72150-74-5	\N	1	กิตติภณ	\N	มงคล	1	1	0	0	9	ถนนงามวงศ์วาน	\N	\N	4001	2566	102	1	3.57	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	5-5290-66032-16-9	\N	2	มณีรัตน์	\N	นามมนตรี	2	1	0	0	4	ถนนนวมินทร์	\N	\N	4003	2567	101	3	3.93	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	2-1255-94120-97-6	\N	2	ดวงใจ	\N	ลือชา	2	1	0	0	4	ถนนรามคำแหง	\N	\N	4005	2567	101	1	3.18	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	7-7972-86850-77-9	\N	1	ปิยังกูร	\N	บริบูรณ์	1	1	0	0	3	ถนนรัตนาธิเบศร์	\N	\N	4005	2563	105	3	2.51	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	8-3253-43265-58-4	\N	3	ชนิดา	\N	ชูศรี	2	1	0	0	1	ถนนบรมราชชนนี	\N	\N	4002	2563	105	1	2.55	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	4-8365-31329-76-4	\N	3	จันทร์เพ็ญ	\N	สมบูรณ์	2	1	0	0	4	ถนนเพชรเกษม	\N	\N	4003	2558	421	1	3.66	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	3-4442-32597-76-9	\N	1	รัฐนนท์	\N	อ่อนน้อม	1	1	0	0	1	ถนนประดิษฐ์มนูธรรม	\N	\N	4005	2557	422	1	2.78	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	4-3879-10276-12-2	\N	1	ดิศรณ์	\N	รักษ์ไทย	1	1	0	0	9	ถนนบายพาส	\N	\N	4001	2556	423	1	2.03	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	1	10010003	8-7328-25951-11-9	\N	3	อัมพร	\N	ศรีสุข	2	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	4001	2567	103	3	3.71	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	4-5740-51854-93-4	\N	1	ประพันธ์	\N	เจริญชัย	1	1	0	0	2	ถนนโชคชัย	\N	\N	4001	2566	102	1	3.88	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	6-6068-63564-85-6	\N	1	สุรชัย	\N	นามมนตรี	1	1	0	0	2	ถนนลาดพร้าว	\N	\N	4004	2562	106	3	2.28	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	4	10010003	1-7063-46562-52-7	\N	1	ชินดนัย	\N	สีดา	1	1	0	0	8	ถนนงามวงศ์วาน	\N	\N	4001	2556	423	2	3.83	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	2-1213-94843-60-6	\N	2	ณัฐนิชา	\N	สกุลดี	2	1	0	0	5	ถนนบรมราชชนนี	\N	\N	4004	2563	105	2	2.54	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	3	10010003	6-2647-62274-88-5	\N	1	สมศักดิ์	\N	สุขสันต์	1	1	0	0	10	ถ.เอกชัย	\N	\N	4002	2559	113	1	3.62	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	7-7876-81858-35-5	\N	1	คุณากร	\N	นิ่มนวล	1	1	0	0	9	ถนนชัยพฤกษ์	\N	\N	4001	2560	112	3	3.52	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	4-9846-66813-81-9	\N	3	บุษยา	\N	เพ็งพา	2	1	0	0	9	ถนนรามคำแหง	\N	\N	4004	2558	421	2	3.57	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	7-3959-57581-68-2	\N	3	ปิยนุช	\N	ธนาคาร	2	1	0	0	10	ถ.รัฐพัฒนา	\N	\N	4005	2560	112	2	2.06	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	6-8447-92714-76-9	\N	2	ณัฐนิชา	\N	บุญมี	2	1	0	0	3	ถนนบายพาส	\N	\N	4001	2561	111	1	2.98	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	1	10010003	3-2193-70422-56-6	\N	1	พิพัฒน์	\N	วงษ์สุวรรณ	1	1	0	0	9	ถนนห้วยแก้ว	\N	\N	4005	2557	422	3	2.74	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	3-8999-48901-59-3	\N	1	เจษฎา	\N	กิตติคุณ	1	1	0	0	2	ถนนเพชรเกษม	\N	\N	4004	2562	106	3	2.18	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	7-5362-33203-30-3	\N	1	กันตภณ	\N	วงษ์สุวรรณ	1	1	0	0	10	ถ.เอกชัย	\N	\N	4005	2556	423	2	3.88	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	5-3160-23793-80-6	\N	2	วาสนา	\N	มีสุข	2	1	0	0	5	ถนนกลางเมือง	\N	\N	4001	2558	421	3	3.46	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	3-3069-58125-73-1	\N	3	ปัณฑิตา	\N	สกุลดี	2	1	0	0	10	ถนนสุขุมวิท	\N	\N	4005	2557	422	1	3.69	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	7-5507-16925-68-3	\N	1	วรากร	\N	ยิ้มแย้ม	1	1	0	0	4	ถนนสรงประภา	\N	\N	4004	2567	103	3	3.82	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	5-1082-17656-21-8	\N	2	กาญจนา	\N	วิริยะ	2	1	0	0	9	ถนนเจริญกรุง	\N	\N	4002	2556	423	3	2.66	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	7-2187-61050-79-6	\N	1	ดิศรณ์	\N	สุดสวย	1	1	0	0	1	ถ.เอกชัย	\N	\N	4003	2556	423	1	2.18	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	1-2498-25226-83-6	\N	1	ณัฐพล	\N	ธนาคาร	1	1	0	0	1	ถนนศรีนครินทร์	\N	\N	4003	2563	105	3	3.4	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	1-6942-39807-66-1	\N	2	ภัทรวดี	\N	วิไลวรรณ	2	1	0	0	10	ถนนสรงประภา	\N	\N	4002	2561	111	1	3.55	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	1-1075-73421-42-2	\N	1	กิตติภณ	\N	ทองดี	1	1	0	0	9	ถนนนิมมานเหมินท์	\N	\N	4004	2559	113	2	3.19	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	4-7752-55169-26-5	\N	3	ดวงใจ	\N	อินทร์ชัย	2	1	0	0	5	ถ.เอกชัย	\N	\N	4002	2566	102	3	3.2	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	3-8768-36500-49-9	\N	1	รชานนท์	\N	สุขสันต์	1	1	0	0	2	ถนนสาทร	\N	\N	4001	2559	113	3	3.03	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	1	10010003	7-4633-99732-33-2	\N	1	กิตติภณ	\N	หอมหวาน	1	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	4003	2559	113	1	2.7	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	3	10010003	4-6527-29842-63-9	\N	1	วรพล	\N	เกียรติสกุล	1	1	0	0	1	ถนนสุดสาคร	\N	\N	4004	2567	101	3	3.65	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	4	10010003	4-5118-49265-79-9	\N	3	บุษยา	\N	ทองดี	2	1	0	0	4	ถนนประดิษฐ์มนูธรรม	\N	\N	4004	2560	112	1	3.18	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	4	10010003	5-7650-28074-79-1	\N	3	ธัญชนก	\N	พรสวรรค์	2	1	0	0	6	ถนนช้างเผือก	\N	\N	4002	2563	105	3	3.94	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	6-8356-91248-52-6	\N	1	กวินท์	\N	ปัญญาดี	1	1	0	0	2	ถนนกลางเมือง	\N	\N	4004	2563	105	3	2.1	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	6-6317-24043-15-8	\N	2	รัตนาภรณ์	\N	ดำรงค์	2	1	0	0	5	ถนนสุขุมวิท	\N	\N	4002	2562	106	3	2.07	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	7-2552-88777-97-1	\N	1	วิชญ์พล	\N	จันทร์แก้ว	1	1	0	0	3	ถนนช้างเผือก	\N	\N	4001	2563	105	2	3.56	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	1	10010003	3-1389-63231-89-6	\N	3	จันทร์เพ็ญ	\N	สุจริต	2	1	0	0	4	ถนนห้วยแก้ว	\N	\N	4004	2561	111	3	3.46	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	3-8171-51123-82-6	\N	2	ดวงใจ	\N	สุจริต	2	1	0	0	1	ถนนพหลโยธิน	\N	\N	4002	2560	112	1	3.33	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	4-3999-55485-93-5	\N	1	รชานนท์	\N	งามดี	1	1	0	0	8	ถนนช้างเผือก	\N	\N	4001	2560	112	2	2.22	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	4-3115-70777-86-9	\N	1	กวินท์	\N	พันธุ์ดี	1	1	0	0	1	ถนนมิตรภาพ	\N	\N	4001	2567	101	1	3.65	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	1	10010003	5-4542-49854-11-4	\N	2	นวลจันทร์	\N	อินทร์ชัย	2	1	0	0	10	ถนนรามคำแหง	\N	\N	4001	2563	105	1	3.97	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	1	10010003	5-2055-19438-79-5	\N	1	กันตภณ	\N	สุวรรณภูมิ	1	1	0	0	10	ถนนเพชรเกษม	\N	\N	4002	2563	105	1	2.86	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	6-6670-41933-57-6	\N	1	ชัยชนะ	\N	ชัยมงคล	1	1	0	0	3	ถนนลาดพร้าว	\N	\N	4005	2564	104	1	3.93	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	1-1314-62138-83-7	\N	2	นภาพร	\N	ทองดี	2	1	0	0	9	ถนนรัตนาธิเบศร์	\N	\N	4001	2561	111	2	3.22	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	4-8847-75661-44-3	\N	1	ปิยังกูร	\N	เจริญชัย	1	1	0	0	4	ถนนอ่อนนุช	\N	\N	4004	2561	111	2	2.28	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	7-3575-53800-51-1	\N	3	สุดารัตน์	\N	อินทร์ชัย	2	1	0	0	4	ถนนราษฎร์บูรณะ	\N	\N	4001	2567	101	2	3.24	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	7-4008-47469-23-8	\N	2	พิมพ์ชนก	\N	กิตติคุณ	2	1	0	0	9	ถนนเยาวราช	\N	\N	4002	2557	422	2	2.51	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	4-4626-50332-52-2	\N	1	มานพ	\N	แสงสว่าง	1	1	0	0	2	ถนนพหลโยธิน	\N	\N	4002	2562	106	3	3.56	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	7-9362-43197-41-1	\N	1	สุทธิพงษ์	\N	ทองดี	1	1	0	0	3	ถนนรามคำแหง	\N	\N	4004	2567	101	2	2.87	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	1-5613-98911-52-8	\N	1	วีรชัย	\N	ประสิทธิ์ผล	1	1	0	0	6	ถนนประดิษฐ์มนูธรรม	\N	\N	4004	2561	111	1	3.31	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	7-6106-31952-60-1	\N	2	ชนิดา	\N	วงษ์สุวรรณ	2	1	0	0	4	ถนนสุรวงศ์	\N	\N	4002	2564	104	3	3.27	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	3-2273-43532-69-8	\N	2	รุ่งอรุณ	\N	พรสวรรค์	2	1	0	0	1	ถนนสรงประภา	\N	\N	4001	2559	113	2	2.74	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	1-3964-34778-65-3	\N	1	กวินท์	\N	ศรีสุข	1	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	4001	2558	421	1	2.45	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	1-6997-84126-22-7	\N	1	สมชาย	\N	พรประเสริฐ	1	1	0	0	2	ถนนรามคำแหง	\N	\N	4001	2567	103	3	3.84	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	6-8598-71662-31-2	\N	3	สิริมา	\N	ชัยมงคล	2	1	0	0	7	ถนนประดิษฐ์มนูธรรม	\N	\N	4005	2557	422	1	3.46	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	4-2100-81760-58-3	\N	1	สมศักดิ์	\N	แสงสว่าง	1	1	0	0	9	ถ.เอกชัย	\N	\N	4003	2559	113	2	3.07	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	3	10010003	3-3754-72491-30-1	\N	1	ธนพัฒน์	\N	นามมนตรี	1	1	0	0	1	ถนนศรีนครินทร์	\N	\N	4003	2557	422	1	3.31	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	2	10010003	4-3216-96833-29-1	\N	1	ทักษิณ	\N	พันธุ์ดี	1	1	0	0	5	ถนนบรมราชชนนี	\N	\N	4005	2562	106	3	3.85	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	2-2081-65241-56-4	\N	3	อภิญญา	\N	นามมนตรี	2	1	0	0	1	ถนนสรงประภา	\N	\N	4002	2567	101	3	3.79	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	3-4588-27196-26-8	\N	1	ปรเมศวร์	\N	ทองดี	1	1	0	0	8	ถนนมิตรภาพ	\N	\N	4002	2558	421	2	3.87	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	3-9246-22260-63-6	\N	1	อนุชา	\N	จันทร์แก้ว	1	1	0	0	1	ถนนมาลัยแมน	\N	\N	4002	2564	104	3	2.55	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	4-8208-69889-68-6	\N	2	จิราพร	\N	สุขสบาย	2	1	0	0	7	ถนนเพชรเกษม	\N	\N	4001	2567	101	3	3.69	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	1	10010003	2-7811-99474-97-2	\N	1	ปรเมศวร์	\N	สง่างาม	1	1	0	0	8	ถนนนิมมานเหมินท์	\N	\N	4001	2559	113	3	2.32	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	1-5319-42498-79-5	\N	2	จิตรลดา	\N	เพ็งพา	2	1	0	0	2	ถนนบายพาส	\N	\N	4005	2566	102	1	2.68	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	1-9209-17323-56-7	\N	2	รัตนาภรณ์	\N	ดำรงค์	2	1	0	0	9	ถนนกลางเมือง	\N	\N	4001	2564	104	1	2.96	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	3-2378-84754-75-7	\N	3	จิราพร	\N	งามดี	2	1	0	0	6	ถนนกลางเมือง	\N	\N	4001	2563	105	1	3.4	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	8-8069-61316-35-5	\N	1	พิพัฒน์	\N	ชูศรี	1	1	0	0	10	ถนนอ่อนนุช	\N	\N	4003	2557	422	2	3.31	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	1	10010003	7-3740-69456-34-3	\N	1	สุทธิพงษ์	\N	รุ่งเรือง	1	1	0	0	3	ถนนบายพาส	\N	\N	4003	2558	421	2	3.29	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	1	10010003	5-4546-63862-95-3	\N	1	ภัคพล	\N	สุขสันต์	1	1	0	0	6	ถนนประดิษฐ์มนูธรรม	\N	\N	4001	2564	104	2	3.94	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	1-9745-74617-86-2	\N	2	อภิญญา	\N	จันทร์แก้ว	2	1	0	0	10	ถนนมาลัยแมน	\N	\N	4005	2558	421	3	3.77	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	7-5319-38914-35-9	\N	1	วสันต์	\N	พงษ์ไพร	1	1	0	0	6	ถนนสุรวงศ์	\N	\N	4003	2562	106	3	3.2	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	2	10010003	6-9710-40913-38-4	\N	1	วรพล	\N	พันธุ์ดี	1	1	0	0	5	ถนนอ่อนนุช	\N	\N	4004	2564	104	2	3.4	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	8-7646-13668-57-5	\N	1	อนุชา	\N	พงษ์ไพร	1	1	0	0	6	ถ.รัฐพัฒนา	\N	\N	4001	2567	103	3	3.7	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	5-6496-36131-56-4	\N	3	ดวงใจ	\N	กิตติคุณ	2	1	0	0	7	ถนนกลางเมือง	\N	\N	4003	2558	421	2	3.17	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	2-8059-37344-45-3	\N	3	อภิญญา	\N	เจริญชัย	2	1	0	0	2	ถนนศรีนครินทร์	\N	\N	4005	2557	422	2	3.92	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	5-9323-21473-53-3	\N	3	วิมลรัตน์	\N	มณีรัตน์	2	1	0	0	7	ถนนชัยพฤกษ์	\N	\N	4005	2564	104	3	2.8	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	4-1221-69401-45-3	\N	3	ทิพย์สุดา	\N	ประสิทธิ์ผล	2	1	0	0	4	ถนนกลางเมือง	\N	\N	4003	2560	112	1	2.23	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	1	10010003	5-9920-86483-35-4	\N	1	กันตภณ	\N	สมบูรณ์	1	1	0	0	3	ถนนมาลัยแมน	\N	\N	4004	2556	423	2	2.11	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	3	10010003	1-8418-84261-62-4	\N	1	พิพัฒน์	\N	สง่างาม	1	1	0	0	8	ถนนสีลม	\N	\N	4003	2557	422	1	3.44	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	2-9121-79576-55-3	\N	1	ณัฐวรรธน์	\N	มณีรัตน์	1	1	0	0	3	ถนนรามคำแหง	\N	\N	4001	2567	101	3	3.53	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	5-6215-30502-36-6	\N	1	ประพันธ์	\N	สีดา	1	1	0	0	5	ถนนศรีนครินทร์	\N	\N	4005	2558	421	1	3.83	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	4-3680-94948-96-1	\N	3	วาสนา	\N	หอมหวาน	2	1	0	0	9	ถนนมาลัยแมน	\N	\N	4003	2562	106	1	2.22	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	7-7558-99386-51-7	\N	2	วันวิสา	\N	อินทร์ชัย	2	1	0	0	4	ถนนอ่อนนุช	\N	\N	4004	2566	102	2	2.7	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	3-8197-80386-18-1	\N	2	พิมพ์ชนก	\N	นามมนตรี	2	1	0	0	6	ถนนห้วยแก้ว	\N	\N	4001	2560	112	3	3.4	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	3-2076-50525-33-6	\N	1	กิตติภณ	\N	มณีรัตน์	1	1	0	0	8	ถนนอ่อนนุช	\N	\N	4002	2558	421	3	2.36	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	2-4565-62166-77-2	\N	1	ภัคพล	\N	มณีรัตน์	1	1	0	0	8	ถนนราษฎร์บูรณะ	\N	\N	4005	2564	104	1	3.94	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	3-9488-61218-32-1	\N	1	ชินดนัย	\N	ศรีสุข	1	1	0	0	10	ถนนศรีนครินทร์	\N	\N	4002	2562	106	3	2.69	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	4-4844-29445-31-3	\N	3	นลินทิพย์	\N	บุญมี	2	1	0	0	8	ถนนสีลม	\N	\N	4003	2567	101	2	3.74	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	2	10010003	8-4638-56404-38-3	\N	1	คุณากร	\N	คงพิทักษ์	1	1	0	0	4	ถนนอุดรดุษฎี	\N	\N	4005	2561	111	1	2.72	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	8-1746-77036-33-7	\N	3	กัญญาณัฐ	\N	ทองดี	2	1	0	0	10	ถ.บ้านโป่ง	\N	\N	4004	2558	421	1	3.81	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	1-9050-26342-29-7	\N	1	ทัศนัย	\N	วิริยะ	1	1	0	0	2	ถนนมิตรภาพ	\N	\N	4002	2566	102	2	2.56	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	8-8122-44359-78-5	\N	1	นพรัตน์	\N	สุจริต	1	1	0	0	7	ถ.เอกชัย	\N	\N	4005	2563	105	3	2.18	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	4-3502-28564-30-9	\N	1	ณัฐวุฒิ	\N	มีสุข	1	1	0	0	1	ถนนเพชรเกษม	\N	\N	4003	2562	106	1	2.42	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	3-3926-56365-61-1	\N	2	ปาณิสรา	\N	สุวรรณภูมิ	2	1	0	0	7	ถนนศรีนครินทร์	\N	\N	4005	2561	111	1	3.49	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	8-5008-18738-92-2	\N	3	สิริมา	\N	อ่อนน้อม	2	1	0	0	9	ถนนรัตนาธิเบศร์	\N	\N	4001	2564	104	1	3.7	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	6-4753-83254-49-2	\N	3	จิราพร	\N	นามมนตรี	2	1	0	0	9	ถนนห้วยแก้ว	\N	\N	4001	2566	102	1	3.23	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	1-9334-47594-94-7	\N	1	ธนภัทร	\N	เพียรดี	1	1	0	0	4	ถ.เอกชัย	\N	\N	4001	2567	101	2	2.76	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	5-2191-32843-90-2	\N	2	นภาพร	\N	วิไลวรรณ	2	1	0	0	6	ถนนบรมราชชนนี	\N	\N	4003	2559	113	1	2.72	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	7-5450-12216-82-2	\N	3	สุมาลี	\N	ใจดี	2	1	0	0	10	ถนนบายพาส	\N	\N	4001	2561	111	3	2.82	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	3-1986-72542-10-3	\N	1	มานพ	\N	วิไลวรรณ	1	1	0	0	1	ถนนเยาวราช	\N	\N	4004	2558	421	2	2.72	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	8-2574-27819-94-2	\N	1	ภัคพล	\N	เพ็งพา	1	1	0	0	3	ถนนนิมมานเหมินท์	\N	\N	4001	2557	422	3	3.73	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	8-7651-14762-82-9	\N	1	ชินดนัย	\N	ดำรงค์	1	1	0	0	8	ถนนสาทร	\N	\N	4002	2567	103	3	2.93	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	3-3160-67389-93-7	\N	1	ดิศรณ์	\N	สกุลดี	1	1	0	0	1	ถ.รัฐพัฒนา	\N	\N	4004	2567	101	1	2.62	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	4	10010003	4-6058-36609-24-2	\N	3	ดวงใจ	\N	อ่อนน้อม	2	1	0	0	7	ถนนช้างเผือก	\N	\N	4005	2560	112	2	2.47	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	3-1748-30780-25-2	\N	2	กุลธิดา	\N	วิริยะ	2	1	0	0	6	ถนนสุขุมวิท	\N	\N	4005	2566	102	1	2.85	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	5-8863-10902-16-1	\N	3	ศิริพร	\N	นามมนตรี	2	1	0	0	3	ถนนมาลัยแมน	\N	\N	4003	2556	423	3	2.91	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	8-8375-50568-21-7	\N	3	จิราพร	\N	ขาวสะอาด	2	1	0	0	4	ถนนบายพาส	\N	\N	4005	2567	103	2	2.92	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	6-6156-38913-70-4	\N	2	อัมพร	\N	หอมหวาน	2	1	0	0	1	ถนนบายพาส	\N	\N	4003	2558	421	1	2.81	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	6-3250-84620-99-7	\N	3	ดรุณี	\N	นิ่มนวล	2	1	0	0	4	ถนนห้วยแก้ว	\N	\N	4002	2564	104	2	2.34	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	3-7029-55844-24-3	\N	1	ณัฐพล	\N	สุดสวย	1	1	0	0	9	ถนนราษฎร์บูรณะ	\N	\N	4003	2563	105	2	3.44	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	2	10010003	5-9593-91364-81-6	\N	2	สุนิสา	\N	สกุลดี	2	1	0	0	10	ถนนสุดสาคร	\N	\N	4003	2559	113	1	3.71	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	2	10010003	5-5786-39020-49-5	\N	3	วิมลรัตน์	\N	เพียรดี	2	1	0	0	2	ถนนนิมมานเหมินท์	\N	\N	4004	2559	113	2	3.94	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	4-5234-46148-84-8	\N	1	ธัชพล	\N	ดำรงค์	1	1	0	0	5	ถนนสีลม	\N	\N	4005	2567	103	1	3.56	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	1-6377-75602-63-3	\N	3	สุนิสา	\N	มณีรัตน์	2	1	0	0	10	ถ.เอกชัย	\N	\N	4005	2564	104	1	2.46	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	5-2634-42660-30-2	\N	1	สุทธิพงษ์	\N	เพียรดี	1	1	0	0	1	ถ.ประชาสามัคคี	\N	\N	4005	2567	103	3	3.74	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	8-6354-49499-76-6	\N	1	ณัฐพล	\N	สุดสวย	1	1	0	0	4	ถนนวิภาวดีรังสิต	\N	\N	4002	2564	104	2	3.57	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	1-1703-49553-45-7	\N	3	ทิพย์สุดา	\N	ลือชา	2	1	0	0	5	ถนนบายพาส	\N	\N	4005	2564	104	1	2.27	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	1-3317-56631-23-3	\N	1	อภิวัฒน์	\N	สีดา	1	1	0	0	2	ถนนสาทร	\N	\N	4005	2560	112	3	2.11	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	6-8722-10303-81-7	\N	3	เกวลิน	\N	สุวรรณภูมิ	2	1	0	0	2	ถนนสาทร	\N	\N	4005	2560	112	2	2.38	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	6-7497-60841-38-2	\N	1	สิรภพ	\N	วังขวา	1	1	0	0	2	ถนนสีลม	\N	\N	4003	2560	112	2	2.38	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	2	10010003	3-1548-42592-34-5	\N	2	วรรณภา	\N	พันธุ์ดี	2	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	4002	2560	112	2	2.32	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	8-7810-76117-98-7	\N	1	สิรภพ	\N	รุ่งเรือง	1	1	0	0	9	ถนนสุขุมวิท	\N	\N	4002	2566	102	1	2.95	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	7-1821-30052-93-2	\N	1	นพรัตน์	\N	ธนาคาร	1	1	0	0	8	ถ.ประชาสามัคคี	\N	\N	4003	2557	422	3	3.72	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	1	10010003	6-1957-30337-39-9	\N	3	ชลธิชา	\N	หอมหวาน	2	1	0	0	6	ถนนรัตนาธิเบศร์	\N	\N	4002	2556	423	2	2.42	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	6-3968-68779-53-3	\N	1	ดิศรณ์	\N	ปัญญาดี	1	1	0	0	4	ถนนอ่อนนุช	\N	\N	4005	2559	113	2	2.84	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	3-6409-62595-83-2	\N	1	คุณากร	\N	รักษ์ไทย	1	1	0	0	4	ถนนสาทร	\N	\N	4005	2564	104	1	2.45	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	8-2109-26102-95-7	\N	1	วิชญ์พล	\N	มณีรัตน์	1	1	0	0	8	ถนนกลางเมือง	\N	\N	4002	2556	423	2	2.82	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	6-6164-42653-17-3	\N	1	กวินท์	\N	มงคล	1	1	0	0	5	ถนนกลางเมือง	\N	\N	4004	2567	101	2	3.41	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	5-8989-32364-40-1	\N	1	ณัฐพล	\N	วงษ์สุวรรณ	1	1	0	0	4	ถนนกาญจนาภิเษก	\N	\N	4002	2561	111	3	3.25	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	1-2488-69535-30-3	\N	1	กิตติภณ	\N	บุญมี	1	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	4005	2567	103	2	2.32	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	8-2664-72427-92-8	\N	1	ประพันธ์	\N	แสงสว่าง	1	1	0	0	6	ถนนเยาวราช	\N	\N	4004	2562	106	2	3.32	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	4	10010003	4-9795-67764-29-8	\N	2	ภัทรวดี	\N	หอมหวาน	2	1	0	0	3	ถนนช้างเผือก	\N	\N	4001	2556	423	2	3.28	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	6-7312-61668-78-5	\N	1	ธนาธิป	\N	รักษ์ไทย	1	1	0	0	5	ถนนโชคชัย	\N	\N	4003	2564	104	1	3.64	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	2	10010003	2-4052-23071-26-2	\N	1	ปัณณทัต	\N	กิตติคุณ	1	1	0	0	2	ถนนรัตนาธิเบศร์	\N	\N	4002	2557	422	2	3.15	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	7-1819-97767-19-8	\N	1	คุณากร	\N	บริบูรณ์	1	1	0	0	1	ถ.บ้านโป่ง	\N	\N	4005	2567	101	1	3.55	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	5-6815-33357-86-6	\N	2	ดวงใจ	\N	พรสวรรค์	2	1	0	0	2	ถ.บ้านโป่ง	\N	\N	4002	2561	111	1	2.83	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	4-4609-83080-68-3	\N	1	ธนาธิป	\N	สมบูรณ์	1	1	0	0	3	ถนนสุขุมวิท	\N	\N	4002	2566	102	2	3.62	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	6-5270-87477-92-7	\N	2	วิมลรัตน์	\N	รักษ์ไทย	2	1	0	0	4	ถนนอ่อนนุช	\N	\N	4001	2566	102	1	3.07	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	2	10010003	8-1303-49941-74-9	\N	1	อนุชา	\N	บุญรอด	1	1	0	0	8	ถนนโชคชัย	\N	\N	4002	2567	103	2	2.73	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	7-9314-99699-54-2	\N	3	พิมพ์ชนก	\N	บริบูรณ์	2	1	0	0	10	ถนนห้วยแก้ว	\N	\N	4001	2562	106	1	3.72	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	3-7508-65985-91-4	\N	1	ณัฐวรรธน์	\N	มีสุข	1	1	0	0	3	ถนนห้วยแก้ว	\N	\N	4004	2561	111	3	3.46	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	4	10010003	3-3621-57014-82-3	\N	3	พรทิพย์	\N	สมบูรณ์	2	1	0	0	1	ถนนมาลัยแมน	\N	\N	4004	2566	102	2	2.98	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	3-1455-95736-57-3	\N	1	ธัชพล	\N	สุวรรณภูมิ	1	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	4005	2564	104	1	3.66	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	6-6174-97141-99-7	\N	1	วรากร	\N	วิไลวรรณ	1	1	0	0	4	ถนนอุดรดุษฎี	\N	\N	4004	2560	112	1	2.3	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	4	10010003	5-3947-15602-65-7	\N	1	เจษฎา	\N	เพียรดี	1	1	0	0	2	ถนนช้างเผือก	\N	\N	4002	2557	422	1	3.65	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	2-4654-95813-78-1	\N	2	เพ็ญพักตร์	\N	อ่อนน้อม	2	1	0	0	1	ถนนกาญจนาภิเษก	\N	\N	4005	2557	422	1	2.39	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	3-2546-32661-19-6	\N	1	สมศักดิ์	\N	มงคล	1	1	0	0	5	ถนนโชคชัย	\N	\N	4002	2560	112	3	2.17	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	8-7577-49053-11-2	\N	1	สมศักดิ์	\N	เกียรติสกุล	1	1	0	0	10	ถนนรามคำแหง	\N	\N	4005	2564	104	2	3.18	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	1-1697-60890-32-9	\N	2	ปาณิสรา	\N	เจริญชัย	2	1	0	0	8	ถ.ประชาสามัคคี	\N	\N	4003	2557	422	1	3.67	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	7-6092-25565-86-7	\N	3	นลินทิพย์	\N	พรประเสริฐ	2	1	0	0	3	ถนนสาทร	\N	\N	4003	2567	103	3	2.92	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	2	10010003	3-3933-19843-34-3	\N	2	รุ่งอรุณ	\N	ศรีสุข	2	1	0	0	1	ถนนนิมมานเหมินท์	\N	\N	4005	2564	104	3	3.87	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	2-5610-73648-75-2	\N	1	กิตติภณ	\N	พันธุ์ดี	1	1	0	0	2	ถ.เอกชัย	\N	\N	4002	2567	101	2	3.3	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	2-3635-77330-99-4	\N	3	นันทพร	\N	ชูศรี	2	1	0	0	2	ถนนประดิษฐ์มนูธรรม	\N	\N	4005	2566	102	3	2.92	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	3-1034-18177-10-6	\N	1	ณัฐพล	\N	อินทร์ชัย	1	1	0	0	4	ถนนราษฎร์บูรณะ	\N	\N	4004	2566	102	2	2.53	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	6-3940-45409-41-9	\N	3	กุลธิดา	\N	ดีสมัย	2	1	0	0	4	ถนนประดิษฐ์มนูธรรม	\N	\N	4001	2558	421	2	3.26	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	1-1977-69126-60-9	\N	1	สมชาย	\N	ศักดิ์สิทธิ์	1	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	4002	2566	102	3	2.76	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	4-9218-89877-59-4	\N	3	ประภา	\N	พงษ์ไพร	2	1	0	0	4	ถ.เอกชัย	\N	\N	4002	2567	103	3	3.99	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	7-3900-62120-68-2	\N	2	วันวิสา	\N	วิริยะ	2	1	0	0	4	ถนนอุดรดุษฎี	\N	\N	4003	2562	106	3	3.93	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	2	10010003	3-4295-39571-87-3	\N	2	ภัทรวดี	\N	ใจดี	2	1	0	0	2	ถนนนวมินทร์	\N	\N	4002	2557	422	3	3.01	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	8-6330-12593-61-8	\N	1	สมชาย	\N	สมบูรณ์	1	1	0	0	8	ถนนบายพาส	\N	\N	4004	2564	104	3	3.74	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	3	10010003	2-5364-42422-19-3	\N	1	ชัยชนะ	\N	ทองดี	1	1	0	0	8	ถ.ประชาสามัคคี	\N	\N	4004	2567	103	3	2.5	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	3	10010003	4-9864-49178-54-8	\N	3	สุภัสสรา	\N	วิริยะ	2	1	0	0	3	ถนนสุขุมวิท	\N	\N	4001	2560	112	3	2.84	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	7-9746-60393-31-6	\N	1	อนุชา	\N	ประสิทธิ์ผล	1	1	0	0	10	ถนนเพชรเกษม	\N	\N	4004	2560	112	3	3.91	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	3	10010003	3-6626-52749-38-5	\N	1	ณัฐวุฒิ	\N	มีสุข	1	1	0	0	7	ถนนพหลโยธิน	\N	\N	4002	2559	113	3	3.01	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	8-3338-90916-62-7	\N	3	วันวิสา	\N	บุญมี	2	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	4005	2561	111	1	3	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	1-8492-50238-97-8	\N	1	ทัศนัย	\N	มีสุข	1	1	0	0	5	ถนนประดิษฐ์มนูธรรม	\N	\N	4005	2563	105	2	2.97	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	1	10010003	5-2843-63864-69-4	\N	3	แสงดาว	\N	ประสิทธิ์ผล	2	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	4003	2556	423	3	2.39	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	7-5799-86582-78-1	\N	3	สิริมา	\N	สีดา	2	1	0	0	5	ถนนวิภาวดีรังสิต	\N	\N	4005	2566	102	3	2.66	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	3-2937-14115-30-7	\N	2	พิมพ์ชนก	\N	เพียรดี	2	1	0	0	3	ถ.รัฐพัฒนา	\N	\N	4005	2556	423	1	2.65	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	1-9918-33480-44-9	\N	1	ธัชพล	\N	ประสิทธิ์ผล	1	1	0	0	5	ถนนมิตรภาพ	\N	\N	4003	2556	423	3	3.8	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	4-1674-53238-71-5	\N	1	ชูเกียรติ	\N	อินทร์ชัย	1	1	0	0	9	ถนนประดิษฐ์มนูธรรม	\N	\N	4001	2564	104	3	3.23	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	6-7815-41006-11-3	\N	1	ทักษิณ	\N	คงพิทักษ์	1	1	0	0	8	ถนนกลางเมือง	\N	\N	4004	2558	421	3	3.99	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	7-7607-23346-85-6	\N	1	ณัฐพล	\N	สุขสบาย	1	1	0	0	4	ถนนสุขุมวิท	\N	\N	4002	2562	106	3	2.69	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	3	10010003	8-9869-97158-47-7	\N	3	นภาพร	\N	จันทร์แก้ว	2	1	0	0	8	ถนนรัตนาธิเบศร์	\N	\N	4005	2566	102	3	2.79	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	1-1511-24810-90-4	\N	2	สุมาลี	\N	อ่อนน้อม	2	1	0	0	7	ถนนกลางเมือง	\N	\N	4001	2567	101	2	2.74	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	3	10010003	5-3154-88833-86-1	\N	1	ณัฐพล	\N	อินทร์ชัย	1	1	0	0	7	ถ.เอกชัย	\N	\N	4003	2560	112	2	3.9	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	4	10010003	1-7190-28581-26-2	\N	3	รุ่งอรุณ	\N	สกุลดี	2	1	0	0	6	ถนนมิตรภาพ	\N	\N	4005	2557	422	2	2.33	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	2	10010003	3-3046-89821-11-6	\N	2	กาญจนา	\N	วิไลวรรณ	2	1	0	0	4	ถนนสาทร	\N	\N	4004	2556	423	1	3.88	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	3	10010003	5-9866-47823-97-6	\N	2	ลลิตา	\N	หอมหวาน	2	1	0	0	6	ถนนสีลม	\N	\N	4004	2562	106	2	3.8	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	8-2340-27980-46-6	\N	2	ชนิดา	\N	จันทร์แก้ว	2	1	0	0	6	ถนนสาทร	\N	\N	4002	2558	421	1	2.63	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	7-3092-96299-33-2	\N	1	ดิศรณ์	\N	สุดสวย	1	1	0	0	2	ถ.เอกชัย	\N	\N	4005	2567	103	1	3.53	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	5-9782-94218-79-4	\N	1	ชูเกียรติ	\N	ยิ้มแย้ม	1	1	0	0	10	ถนนมิตรภาพ	\N	\N	4002	2561	111	2	2.48	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	2	10010003	5-3790-99295-54-3	\N	3	จันทร์เพ็ญ	\N	ศักดิ์สิทธิ์	2	1	0	0	6	ถนนเพชรเกษม	\N	\N	4003	2556	423	1	3.17	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	5	10010003	1-6504-16845-77-1	\N	3	สุภัสสรา	\N	กิตติคุณ	2	1	0	0	6	ถนนนิมมานเหมินท์	\N	\N	4003	2567	101	1	3.17	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	3	10010003	6-4519-56743-28-5	\N	1	สิรภพ	\N	มีสุข	1	1	0	0	8	ถนนเจริญกรุง	\N	\N	4004	2563	105	2	2.94	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	8-4267-44073-47-4	\N	3	สุภัสสรา	\N	ศรีสุข	2	1	0	0	1	ถนนช้างเผือก	\N	\N	4003	2567	103	2	3.46	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	1	10010003	4-7902-20898-18-4	\N	1	วุฒิพงษ์	\N	วิริยะ	1	1	0	0	4	ถนนเจริญกรุง	\N	\N	4005	2566	102	1	2.79	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	3-2119-56219-32-8	\N	1	ภัคพล	\N	ทองดี	1	1	0	0	9	ถ.เอกชัย	\N	\N	4005	2561	111	3	3.16	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	2-6135-33794-25-8	\N	1	ธนภัทร	\N	พันธุ์ดี	1	1	0	0	5	ถนนมาลัยแมน	\N	\N	4005	2563	105	1	2.63	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	2-6836-65686-97-8	\N	2	รุ่งอรุณ	\N	วิไลวรรณ	2	1	0	0	4	ถนนวิภาวดีรังสิต	\N	\N	4002	2561	111	3	2.29	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	4	10010003	3-7512-87181-18-5	\N	3	นภาพร	\N	วงษ์สุวรรณ	2	1	0	0	4	ถนนสาทร	\N	\N	4004	2566	102	3	3.07	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	3	10010003	1-1605-24701-16-9	\N	3	อรณิชา	\N	เจริญชัย	2	1	0	0	10	ถนนประดิษฐ์มนูธรรม	\N	\N	4004	2564	104	2	2.29	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	5	10010003	6-3682-22478-20-9	\N	2	กาญจนา	\N	ดำรงค์	2	1	0	0	10	ถนนมาลัยแมน	\N	\N	4001	2556	423	1	3.67	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	4	10010003	5-8500-86393-57-8	\N	2	วิมลรัตน์	\N	อ่อนน้อม	2	1	0	0	3	ถนนประดิษฐ์มนูธรรม	\N	\N	4003	2560	112	2	3.47	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	3	10010003	2-1841-33481-28-2	\N	3	ศิริพร	\N	ยิ้มแย้ม	2	1	0	0	8	ถ.รัฐพัฒนา	\N	\N	4005	2567	103	3	2.43	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	8-2342-70571-11-6	\N	1	ปรเมศวร์	\N	ขาวสะอาด	1	1	0	0	10	ถนนเจริญกรุง	\N	\N	4005	2559	113	1	3.28	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	3-9570-61277-76-2	\N	3	ปาณิสรา	\N	พรสวรรค์	2	1	0	0	2	ถนนศรีนครินทร์	\N	\N	4001	2557	422	1	2.85	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	7-9787-24952-20-4	\N	1	วสันต์	\N	มณีรัตน์	1	1	0	0	10	ถ.บ้านโป่ง	\N	\N	4002	2560	112	3	2.68	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010003	3-2726-68365-69-1	\N	1	กันตภณ	\N	ชัยมงคล	1	1	0	0	6	ถนนห้วยแก้ว	\N	\N	4005	2567	101	1	3.61	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	5	10010003	6-2465-92313-94-6	\N	1	นพรัตน์	\N	สกุลดี	1	1	0	0	9	ถนนนวมินทร์	\N	\N	4004	2563	105	1	2.44	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	1	10010003	3-7464-12618-25-2	\N	1	ทัศนัย	\N	สีดา	1	1	0	0	10	ถนนสุรวงศ์	\N	\N	4004	2558	421	3	2.64	10	ขอนแก่น	เมืองขอนแก่น	เมืองเก่า
2569	1	2	10010003	5-3202-94714-50-6	\N	1	ธนภัทร	\N	พงษ์ไพร	1	1	0	0	2	ถนนสุรวงศ์	\N	\N	4005	2566	102	3	3.98	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	2-1699-47146-51-1	\N	2	ปัณฑิตา	\N	สุดสวย	2	1	0	0	3	ถนนนิมมานเหมินท์	\N	\N	4005	2561	111	3	3.64	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	4	10010003	8-4369-59691-61-3	\N	1	สมศักดิ์	\N	บริบูรณ์	1	1	0	0	8	ถนนบรมราชชนนี	\N	\N	4002	2562	106	1	3.81	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	5	10010003	4-6787-41718-89-1	\N	1	อนุชา	\N	สุวรรณภูมิ	1	1	0	0	1	ถนนช้างเผือก	\N	\N	4005	2562	106	2	3.14	10	ขอนแก่น	เมืองขอนแก่น	พระลับ
2569	1	3	10010003	2-6477-60572-58-4	\N	3	ประภา	\N	วงษ์สุวรรณ	2	1	0	0	10	ถ.บ้านโป่ง	\N	\N	4003	2561	111	2	3.4	10	ขอนแก่น	เมืองขอนแก่น	บ้านทุ่ม
2569	1	1	10010003	7-1697-96510-27-9	\N	1	สมชาย	\N	สุวรรณภูมิ	1	1	0	0	4	ถ.เอกชัย	\N	\N	4001	2557	422	2	2.58	10	ขอนแก่น	เมืองขอนแก่น	ในเมือง
2569	1	5	10010003	7-7715-10614-53-4	\N	3	ธัญชนก	\N	มณีรัตน์	2	1	0	0	5	ถนนศรีนครินทร์	\N	\N	4002	2563	105	3	2.84	10	ขอนแก่น	เมืองขอนแก่น	สาวะถี
2569	1	1	10010004	7-5074-48232-61-8	\N	2	พิมพ์ชนก	\N	งามดี	2	1	0	0	4	ถนนรามคำแหง	\N	\N	1001	2562	106	1	2.04	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	2-5130-25612-61-1	\N	1	ธนภัทร	\N	พรประเสริฐ	1	1	0	0	1	ถนนบรมราชชนนี	\N	\N	1003	2558	421	3	4	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	8-9715-85650-68-1	\N	2	ดรุณี	\N	ปัญญาดี	2	1	0	0	7	ถนนพหลโยธิน	\N	\N	1001	2558	421	3	2.99	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	7-5013-15325-16-1	\N	2	สุดารัตน์	\N	มงคล	2	1	0	0	10	ถนนโชคชัย	\N	\N	1003	2564	104	2	4	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	4-8301-20811-22-9	\N	2	แสงดาว	\N	พงษ์ไพร	2	1	0	0	2	ถนนห้วยแก้ว	\N	\N	1002	2556	423	1	3.45	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	3-6063-29671-12-4	\N	1	บุญยิ่ง	\N	คงพิทักษ์	1	1	0	0	5	ถนนพหลโยธิน	\N	\N	1003	2561	111	3	2.67	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	1-8315-52159-58-5	\N	1	ประพันธ์	\N	คงมั่น	1	1	0	0	5	ถนนกาญจนาภิเษก	\N	\N	1002	2562	106	2	2.83	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	3-5374-94405-12-3	\N	3	อัมพร	\N	รักษ์ไทย	2	1	0	0	9	ถนนบรมราชชนนี	\N	\N	1003	2558	421	1	2.12	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	5-1018-29567-60-3	\N	1	ปรเมศวร์	\N	อ่อนน้อม	1	1	0	0	1	ถนนเจริญกรุง	\N	\N	1001	2562	106	2	3.19	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	6-4156-63947-49-3	\N	2	วาสนา	\N	กิตติคุณ	2	1	0	0	4	ถนนมิตรภาพ	\N	\N	1002	2564	104	1	3.04	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	3-6439-24048-80-2	\N	2	ณัฐนิชา	\N	พันธุ์ดี	2	1	0	0	7	ถนนงามวงศ์วาน	\N	\N	1001	2567	101	3	2.64	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	7-2874-14155-17-8	\N	1	วสันต์	\N	วิไลวรรณ	1	1	0	0	10	ถนนศรีนครินทร์	\N	\N	1002	2563	105	1	2.57	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	3-4969-78468-28-8	\N	1	ณัฐพล	\N	หอมหวาน	1	1	0	0	2	ถนนสุขุมวิท	\N	\N	1002	2562	106	1	2.11	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	7-2124-55986-21-3	\N	1	วรพล	\N	ทั่วถึง	1	1	0	0	1	ถนนเยาวราช	\N	\N	1001	2559	113	1	3.14	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	5-6112-60047-15-5	\N	3	พิมพ์ชนก	\N	ทั่วถึง	2	1	0	0	3	ถนนชัยพฤกษ์	\N	\N	1002	2564	104	2	2.6	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	1-2754-91531-21-6	\N	2	สุนิสา	\N	มงคล	2	1	0	0	4	ถนนพหลโยธิน	\N	\N	1003	2562	106	2	3.65	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	6-7911-20888-72-7	\N	2	ศิริพร	\N	สีดา	2	1	0	0	9	ถนนราษฎร์บูรณะ	\N	\N	1002	2564	104	1	2.67	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	3-7459-69383-10-9	\N	1	ณัฐวุฒิ	\N	งามดี	1	1	0	0	7	ถนนมาลัยแมน	\N	\N	1001	2564	104	2	3.4	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	8-7697-81536-66-9	\N	3	มณีรัตน์	\N	รักษ์ไทย	2	1	0	0	5	ถนนวิภาวดีรังสิต	\N	\N	1001	2567	101	1	3.93	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	6-1246-14784-62-2	\N	2	พรรษา	\N	เพียรดี	2	1	0	0	9	ถนนนิมมานเหมินท์	\N	\N	1001	2560	112	1	3.28	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	5-1878-50270-63-7	\N	2	สุดารัตน์	\N	บุญมี	2	1	0	0	9	ถนนชัยพฤกษ์	\N	\N	1001	2560	112	2	3.62	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	6-3680-56781-42-3	\N	1	อภิวัฒน์	\N	วงษ์สุวรรณ	1	1	0	0	1	ถนนสุดสาคร	\N	\N	1002	2559	113	2	3.21	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	8-4204-81657-80-2	\N	2	วิมลรัตน์	\N	สง่างาม	2	1	0	0	9	ถนนชัยพฤกษ์	\N	\N	1001	2561	111	3	3.48	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	6-5710-75594-74-3	\N	2	นลินทิพย์	\N	มงคล	2	1	0	0	2	ถนนเจริญกรุง	\N	\N	1003	2560	112	1	2.61	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	1-6690-22889-22-1	\N	3	มาลัย	\N	บุญรอด	2	1	0	0	3	ถนนบรมราชชนนี	\N	\N	1001	2564	104	2	2.67	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	3-5049-13841-25-7	\N	1	ประพันธ์	\N	ขาวสะอาด	1	1	0	0	1	ถนนนิมมานเหมินท์	\N	\N	1001	2567	103	1	3.64	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	7-1866-17661-35-3	\N	2	พิมพ์ชนก	\N	กิตติคุณ	2	1	0	0	1	ถนนอ่อนนุช	\N	\N	1001	2564	104	3	3.51	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	1-2313-21726-45-1	\N	1	ไกรวุฒิ	\N	มีสุข	1	1	0	0	1	ถนนสาทร	\N	\N	1003	2557	422	3	3.21	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	8-7798-15975-23-7	\N	2	กาญจนา	\N	พงษ์ไพร	2	1	0	0	3	ถนนมิตรภาพ	\N	\N	1001	2566	102	3	2.65	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	8-9583-53077-56-1	\N	1	วรพล	\N	วิริยะ	1	1	0	0	2	ถนนงามวงศ์วาน	\N	\N	1002	2557	422	3	3.3	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	2-1370-71937-31-9	\N	1	กวินท์	\N	ชัยมงคล	1	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	1001	2567	101	3	2.75	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	8-2834-64460-23-7	\N	1	สุรชัย	\N	บุญมี	1	1	0	0	1	ถนนประดิษฐ์มนูธรรม	\N	\N	1002	2561	111	1	3.49	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	7-5117-73061-72-2	\N	1	ชูเกียรติ	\N	นิ่มนวล	1	1	0	0	9	ถนนอ่อนนุช	\N	\N	1002	2557	422	1	3.79	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	1-3982-47590-80-1	\N	2	เกวลิน	\N	ทองดี	2	1	0	0	9	ถนนกลางเมือง	\N	\N	1002	2566	102	3	3.79	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	4-3211-37955-60-3	\N	2	พรรษา	\N	สุขสบาย	2	1	0	0	3	ถนนรามคำแหง	\N	\N	1001	2562	106	3	3.74	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	6-8469-44023-60-8	\N	2	มาลัย	\N	ธนาคาร	2	1	0	0	1	ถนนบายพาส	\N	\N	1002	2566	102	3	3.65	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	6-3327-21723-51-1	\N	3	แสงดาว	\N	ใจดี	2	1	0	0	2	ถนนมาลัยแมน	\N	\N	1002	2566	102	3	2.68	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	6-1760-95036-76-5	\N	3	นันทพร	\N	ใจดี	2	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	1001	2566	102	1	2.83	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	4-3243-47821-79-5	\N	1	อนุชา	\N	ทั่วถึง	1	1	0	0	9	ถนนงามวงศ์วาน	\N	\N	1003	2558	421	3	3.08	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	2-1253-51470-39-1	\N	1	ภูมิพัฒน์	\N	สุขสบาย	1	1	0	0	3	ถนนเพชรเกษม	\N	\N	1002	2559	113	3	2.85	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	7-5764-62989-41-4	\N	3	ชลธิชา	\N	ลือชา	2	1	0	0	10	ถนนช้างเผือก	\N	\N	1003	2567	101	3	3.33	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	2-5524-75361-63-5	\N	1	พิพัฒน์	\N	ศักดิ์สิทธิ์	1	1	0	0	3	ถ.บ้านโป่ง	\N	\N	1001	2556	423	1	2.65	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	2-3241-81566-19-8	\N	3	สุภัสสรา	\N	ลือชา	2	1	0	0	8	ถนนช้างเผือก	\N	\N	1001	2567	103	2	2.78	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	2-6592-57484-43-3	\N	1	ปรเมศวร์	\N	อินทร์ชัย	1	1	0	0	7	ถนนลาดพร้าว	\N	\N	1003	2561	111	3	3.1	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	5-8129-58471-45-7	\N	2	รัตนาภรณ์	\N	สีดา	2	1	0	0	8	ถ.รัฐพัฒนา	\N	\N	1002	2559	113	1	2.59	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	4-2001-75541-69-2	\N	1	กิตติภณ	\N	สุวรรณภูมิ	1	1	0	0	6	ถนนบายพาส	\N	\N	1001	2567	103	1	2.25	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	1-4547-22806-72-6	\N	3	ประภา	\N	บุญรอด	2	1	0	0	5	ถนนสีลม	\N	\N	1003	2560	112	2	3.33	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	6-8520-98043-33-7	\N	1	ชูเกียรติ	\N	สมบูรณ์	1	1	0	0	1	ถนนราษฎร์บูรณะ	\N	\N	1002	2567	103	1	3.71	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	8-4046-82745-76-5	\N	1	ชาตรี	\N	หอมหวาน	1	1	0	0	1	ถ.ประชาสามัคคี	\N	\N	1002	2560	112	2	3.96	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	4-3356-72683-18-4	\N	3	อัมพร	\N	บุญมี	2	1	0	0	6	ถนนสาทร	\N	\N	1001	2563	105	3	3.78	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	7-9256-72283-87-1	\N	3	กาญจนา	\N	สุดสวย	2	1	0	0	7	ถนนสุขุมวิท	\N	\N	1001	2560	112	3	2.25	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	6-7070-40843-43-1	\N	3	ปิยนุช	\N	ชูศรี	2	1	0	0	6	ถนนสุขุมวิท	\N	\N	1003	2567	101	1	2.59	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	6-8362-66238-42-1	\N	1	สุรชัย	\N	ดีสมัย	1	1	0	0	6	ถนนอ่อนนุช	\N	\N	1003	2566	102	3	2.63	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	8-9188-54433-54-5	\N	3	สุนิสา	\N	แสงสว่าง	2	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	1003	2559	113	3	3.19	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	3-8812-37532-61-3	\N	1	มานพ	\N	วังขวา	1	1	0	0	8	ถนนสาทร	\N	\N	1001	2563	105	3	2.52	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	2-2743-19831-69-6	\N	1	ณัฐพล	\N	วังขวา	1	1	0	0	8	ถนนอุดรดุษฎี	\N	\N	1001	2561	111	3	2.47	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	3-9899-58752-24-5	\N	1	วุฒิพงษ์	\N	จันทร์แก้ว	1	1	0	0	5	ถนนประดิษฐ์มนูธรรม	\N	\N	1002	2564	104	1	3.6	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	1-4396-86613-32-3	\N	2	ดรุณี	\N	ทองดี	2	1	0	0	1	ถนนศรีนครินทร์	\N	\N	1002	2560	112	1	3.67	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	8-2268-17936-64-9	\N	2	ดรุณี	\N	จันทร์แก้ว	2	1	0	0	1	ถนนงามวงศ์วาน	\N	\N	1002	2561	111	3	2.92	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	1-6610-99817-11-1	\N	2	พรรษา	\N	คงมั่น	2	1	0	0	5	ถนนอ่อนนุช	\N	\N	1001	2563	105	1	2.89	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	7-4667-24828-66-3	\N	1	ธนาธิป	\N	รุ่งเรือง	1	1	0	0	10	ถนนกาญจนาภิเษก	\N	\N	1002	2560	112	2	3.83	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	1-7515-52611-43-1	\N	2	อัมพร	\N	ศักดิ์สิทธิ์	2	1	0	0	3	ถนนมิตรภาพ	\N	\N	1001	2562	106	1	3.92	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	3-9081-33616-79-2	\N	2	ภัทรวดี	\N	ทั่วถึง	2	1	0	0	3	ถนนรามคำแหง	\N	\N	1003	2567	101	1	3.19	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	1-3055-66419-63-8	\N	3	พรทิพย์	\N	อ่อนน้อม	2	1	0	0	7	ถนนช้างเผือก	\N	\N	1001	2567	101	3	3.73	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	8-5338-91714-90-6	\N	1	เจษฎา	\N	เพ็งพา	1	1	0	0	1	ถ.ประชาสามัคคี	\N	\N	1003	2563	105	2	3.95	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	7-9112-57629-62-1	\N	1	ธนพัฒน์	\N	มงคล	1	1	0	0	3	ถนนลาดพร้าว	\N	\N	1003	2559	113	2	3.63	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	3-4050-20191-57-5	\N	1	บุญยิ่ง	\N	วังขวา	1	1	0	0	4	ถนนลาดพร้าว	\N	\N	1001	2557	422	1	3.19	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	4-5051-37038-32-1	\N	2	ปาณิสรา	\N	ชูศรี	2	1	0	0	3	ถนนสุรวงศ์	\N	\N	1001	2563	105	1	2.7	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	1-2859-91027-38-6	\N	2	ชลธิชา	\N	รักษ์ไทย	2	1	0	0	5	ถนนช้างเผือก	\N	\N	1002	2559	113	2	3.71	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	5-4410-91760-34-4	\N	1	วิชญ์พล	\N	มงคล	1	1	0	0	4	ถนนราษฎร์บูรณะ	\N	\N	1002	2556	423	3	3.63	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	1-6682-83967-78-4	\N	3	นลินทิพย์	\N	เพ็งพา	2	1	0	0	2	ถนนสรงประภา	\N	\N	1003	2563	105	1	2.01	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	6-7435-51032-88-3	\N	3	ประภา	\N	วงษ์สุวรรณ	2	1	0	0	1	ถนนรามคำแหง	\N	\N	1001	2561	111	1	3	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	5-7089-46419-30-2	\N	1	ปัณณทัต	\N	กิตติคุณ	1	1	0	0	1	ถนนบายพาส	\N	\N	1002	2562	106	1	2.96	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	8-6601-91544-22-3	\N	1	ไกรวุฒิ	\N	สง่างาม	1	1	0	0	3	ถนนสุดสาคร	\N	\N	1002	2556	423	3	2.41	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	3-7939-45922-70-6	\N	2	ชลธิชา	\N	จันทร์แก้ว	2	1	0	0	3	ถนนโชคชัย	\N	\N	1002	2561	111	1	3.5	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	8-4744-13466-10-3	\N	3	ปาณิสรา	\N	จันทร์แก้ว	2	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	1001	2559	113	3	2.85	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	6-4772-53498-55-1	\N	3	อรณิชา	\N	แสงสว่าง	2	1	0	0	6	ถนนเพชรเกษม	\N	\N	1001	2563	105	3	2.21	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	1-9477-67883-72-8	\N	2	สิริมา	\N	จันทร์แก้ว	2	1	0	0	3	ถนนเยาวราช	\N	\N	1003	2564	104	2	2.63	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	2-9220-81467-40-5	\N	2	จิตรลดา	\N	เกียรติสกุล	2	1	0	0	6	ถนนนวมินทร์	\N	\N	1003	2564	104	1	2.48	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	8-9071-15432-65-8	\N	1	มานพ	\N	สมบูรณ์	1	1	0	0	7	ถนนอ่อนนุช	\N	\N	1003	2566	102	2	3.66	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	7-6804-22487-55-1	\N	1	ปัณณทัต	\N	งามดี	1	1	0	0	3	ถนนช้างเผือก	\N	\N	1001	2566	102	3	3.98	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	6-9639-79521-34-9	\N	3	จันทร์เพ็ญ	\N	สกุลดี	2	1	0	0	3	ถนนห้วยแก้ว	\N	\N	1002	2558	421	3	2.67	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	5-7519-73210-26-3	\N	3	จันทร์เพ็ญ	\N	บุญมี	2	1	0	0	6	ถนนนิมมานเหมินท์	\N	\N	1002	2559	113	1	3.48	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	1-9747-65428-49-5	\N	1	ชูเกียรติ	\N	พรสวรรค์	1	1	0	0	3	ถนนสุดสาคร	\N	\N	1001	2560	112	1	2.92	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	7-3765-82803-30-3	\N	1	ชูเกียรติ	\N	ยิ้มแย้ม	1	1	0	0	3	ถนนมิตรภาพ	\N	\N	1002	2566	102	1	3.68	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	7-3752-49305-67-3	\N	1	ทัศนัย	\N	จันทร์แก้ว	1	1	0	0	9	ถนนมาลัยแมน	\N	\N	1003	2556	423	2	3.46	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	3-3662-42202-45-2	\N	1	มานพ	\N	งามดี	1	1	0	0	5	ถนนศรีนครินทร์	\N	\N	1002	2562	106	3	2.03	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	8-1651-27613-62-7	\N	1	ธนภัทร	\N	คงพิทักษ์	1	1	0	0	1	ถนนเยาวราช	\N	\N	1003	2564	104	2	2.51	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	5-1644-12459-39-2	\N	3	วรรณภา	\N	สกุลดี	2	1	0	0	1	ถนนบรมราชชนนี	\N	\N	1001	2566	102	1	3.22	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	3-5880-70775-21-2	\N	1	ปัณณทัต	\N	เกียรติสกุล	1	1	0	0	10	ถนนสีลม	\N	\N	1001	2558	421	3	2.36	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	1-6248-62425-45-7	\N	2	พิมพ์ชนก	\N	รุ่งเรือง	2	1	0	0	2	ถนนมาลัยแมน	\N	\N	1001	2567	103	1	3.03	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	6-1169-11930-83-6	\N	1	สุรชัย	\N	สกุลดี	1	1	0	0	4	ถ.รัฐพัฒนา	\N	\N	1001	2558	421	2	2.44	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	3-4652-98250-24-4	\N	1	ชินดนัย	\N	นามมนตรี	1	1	0	0	4	ถนนมาลัยแมน	\N	\N	1002	2557	422	2	3.65	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	7-5909-27985-35-2	\N	1	ธนภัทร	\N	อ่อนน้อม	1	1	0	0	7	ถนนมิตรภาพ	\N	\N	1003	2560	112	2	3.43	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	7-9574-57449-71-7	\N	2	วิมลรัตน์	\N	ทั่วถึง	2	1	0	0	1	ถนนอุดรดุษฎี	\N	\N	1001	2567	103	1	3.04	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	5-8021-19104-70-6	\N	1	สิรภพ	\N	คงพิทักษ์	1	1	0	0	6	ถนนเพชรเกษม	\N	\N	1002	2562	106	3	3.95	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	3-5911-33953-15-3	\N	2	ณัฐนิชา	\N	สุขสันต์	2	1	0	0	5	ถนนประดิษฐ์มนูธรรม	\N	\N	1002	2563	105	3	3.13	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	3-4588-45214-54-7	\N	1	กวินท์	\N	ขาวสะอาด	1	1	0	0	6	ถนนอ่อนนุช	\N	\N	1002	2563	105	1	3.54	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	5-9782-58460-38-7	\N	3	ดรุณี	\N	มีสุข	2	1	0	0	3	ถนนมาลัยแมน	\N	\N	1003	2559	113	1	2.72	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	5-2035-95568-11-1	\N	1	กันตภณ	\N	สุดสวย	1	1	0	0	10	ถนนช้างเผือก	\N	\N	1002	2562	106	1	3.03	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	5-3857-21976-60-5	\N	1	ธนพัฒน์	\N	ชัยมงคล	1	1	0	0	4	ถนนห้วยแก้ว	\N	\N	1003	2567	103	2	3.54	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	7-1817-49940-72-7	\N	1	กิตติภณ	\N	ชูศรี	1	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	1001	2567	103	3	2.34	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	1-7491-59175-20-9	\N	1	เจษฎา	\N	วิริยะ	1	1	0	0	8	ถนนมิตรภาพ	\N	\N	1003	2560	112	2	2.42	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	4-7621-82542-18-6	\N	3	ปาณิสรา	\N	มงคล	2	1	0	0	5	ถนนบรมราชชนนี	\N	\N	1002	2559	113	3	3.75	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	3-2802-11453-76-5	\N	2	ปิยนุช	\N	แสงสว่าง	2	1	0	0	6	ถนนลาดพร้าว	\N	\N	1001	2562	106	2	3.85	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	7-1545-54231-14-4	\N	3	นวลจันทร์	\N	มณีรัตน์	2	1	0	0	4	ถ.ประชาสามัคคี	\N	\N	1002	2567	101	2	3.12	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	4-1364-63025-70-2	\N	2	อัมพร	\N	คงมั่น	2	1	0	0	9	ถนนสรงประภา	\N	\N	1001	2567	103	2	3.36	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	5-2331-90518-12-9	\N	1	เอกพงษ์	\N	สมบูรณ์	1	1	0	0	8	ถนนโชคชัย	\N	\N	1002	2560	112	2	3.82	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	4-7794-36784-48-3	\N	2	เกวลิน	\N	วิริยะ	2	1	0	0	9	ถนนโชคชัย	\N	\N	1002	2567	103	1	2.9	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	5-3261-28218-25-8	\N	2	จิราพร	\N	ทั่วถึง	2	1	0	0	1	ถนนเยาวราช	\N	\N	1002	2564	104	1	3.72	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	4-4060-18020-18-7	\N	2	ประภา	\N	บุญรอด	2	1	0	0	3	ถนนพหลโยธิน	\N	\N	1002	2566	102	1	3.11	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	3-9036-25728-81-3	\N	2	กุลธิดา	\N	สง่างาม	2	1	0	0	7	ถนนห้วยแก้ว	\N	\N	1003	2556	423	1	3.35	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	4-2427-98417-40-6	\N	2	รัตนาภรณ์	\N	คงมั่น	2	1	0	0	5	ถนนสุขุมวิท	\N	\N	1003	2564	104	3	3.44	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	7-3943-18324-88-6	\N	1	ศิวกร	\N	สุวรรณภูมิ	1	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	1003	2556	423	2	2.9	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	5-4801-83585-75-5	\N	1	ธนภัทร	\N	เกียรติสกุล	1	1	0	0	4	ถนนรัตนาธิเบศร์	\N	\N	1002	2557	422	3	2.32	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	2-7787-71797-74-1	\N	1	อนุชา	\N	สุจริต	1	1	0	0	7	ถนนบายพาส	\N	\N	1003	2560	112	2	3.45	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	1-2686-59756-93-5	\N	2	รุ่งอรุณ	\N	สุจริต	2	1	0	0	10	ถนนชัยพฤกษ์	\N	\N	1001	2562	106	3	3.06	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	1-3557-64036-90-5	\N	1	ชาตรี	\N	สุขสบาย	1	1	0	0	1	ถ.ประชาสามัคคี	\N	\N	1001	2563	105	1	2.23	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	2-8442-30884-61-3	\N	1	นรวิชญ์	\N	มณีรัตน์	1	1	0	0	9	ถนนราษฎร์บูรณะ	\N	\N	1003	2557	422	1	3.04	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	1-1315-69984-28-9	\N	2	กัญญา	\N	อ่อนน้อม	2	1	0	0	9	ถนนช้างเผือก	\N	\N	1002	2567	103	3	2.79	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	1-7930-87638-97-2	\N	1	ชัยชนะ	\N	อ่อนน้อม	1	1	0	0	10	ถนนบายพาส	\N	\N	1002	2567	101	1	2.61	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	1-9689-27494-12-4	\N	1	ดิศรณ์	\N	พรสวรรค์	1	1	0	0	10	ถนนรามคำแหง	\N	\N	1002	2558	421	2	2.26	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	6-7250-92603-93-3	\N	2	วรรณภา	\N	รุ่งเรือง	2	1	0	0	5	ถนนช้างเผือก	\N	\N	1001	2558	421	2	2.54	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	3-5886-31273-94-6	\N	2	พิมพ์ชนก	\N	สมบูรณ์	2	1	0	0	4	ถนนมาลัยแมน	\N	\N	1001	2557	422	3	3.86	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	1-3992-82262-44-8	\N	1	มานพ	\N	วงษ์สุวรรณ	1	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	1001	2560	112	2	2.73	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	5-4969-59208-50-3	\N	1	ทักษิณ	\N	เจริญชัย	1	1	0	0	5	ถนนลาดพร้าว	\N	\N	1003	2566	102	1	2.7	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	8-7016-46488-96-1	\N	2	มณีรัตน์	\N	สุดสวย	2	1	0	0	4	ถนนสุดสาคร	\N	\N	1002	2558	421	3	3.51	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	4-9483-58423-45-7	\N	2	วาสนา	\N	ศรีสุข	2	1	0	0	7	ถนนชัยพฤกษ์	\N	\N	1002	2562	106	2	4	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	8-9666-63444-46-2	\N	1	ปรเมศวร์	\N	อินทร์ชัย	1	1	0	0	3	ถนนกลางเมือง	\N	\N	1002	2562	106	2	2.81	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	5-4047-89276-77-7	\N	3	ดรุณี	\N	มงคล	2	1	0	0	3	ถนนราษฎร์บูรณะ	\N	\N	1003	2560	112	1	3.5	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	8-7687-33189-34-6	\N	2	ดรุณี	\N	สุขสบาย	2	1	0	0	7	ถนนชัยพฤกษ์	\N	\N	1002	2563	105	2	2.15	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	8-9117-69105-88-3	\N	1	นรวิชญ์	\N	วิไลวรรณ	1	1	0	0	6	ถนนอุดรดุษฎี	\N	\N	1003	2562	106	2	3.11	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	5-5047-22536-51-4	\N	1	พิพัฒน์	\N	ศรีสุข	1	1	0	0	10	ถนนเจริญกรุง	\N	\N	1001	2559	113	3	2.35	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	1-1072-18716-47-5	\N	1	ทัศนัย	\N	คงพิทักษ์	1	1	0	0	1	ถ.รัฐพัฒนา	\N	\N	1001	2560	112	1	2.8	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	2-4567-49389-25-1	\N	2	นันทพร	\N	ธนาคาร	2	1	0	0	4	ถนนเจริญกรุง	\N	\N	1002	2561	111	1	3.77	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	7-6361-97996-59-5	\N	2	ชนิดา	\N	ยิ้มแย้ม	2	1	0	0	3	ถนนสรงประภา	\N	\N	1003	2558	421	1	2.07	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	4-6518-40425-13-8	\N	3	พิมพ์ชนก	\N	นิ่มนวล	2	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	1003	2556	423	1	3.04	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	1-7062-62730-78-3	\N	1	ทักษิณ	\N	หอมหวาน	1	1	0	0	1	ถนนบรมราชชนนี	\N	\N	1003	2556	423	2	2.25	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	7-2646-78969-65-6	\N	3	รุ่งอรุณ	\N	พงษ์ไพร	2	1	0	0	8	ถนนชัยพฤกษ์	\N	\N	1003	2562	106	2	3.23	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	3-6209-39561-19-4	\N	3	พิมพ์ชนก	\N	พงษ์ไพร	2	1	0	0	8	ถนนห้วยแก้ว	\N	\N	1002	2562	106	2	2.24	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	3-2200-75054-54-1	\N	2	ภัทรวดี	\N	แสงสว่าง	2	1	0	0	4	ถนนมาลัยแมน	\N	\N	1002	2557	422	2	2.39	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	6-2162-87435-35-9	\N	1	ทัศนัย	\N	ดำรงค์	1	1	0	0	8	ถนนอ่อนนุช	\N	\N	1003	2556	423	1	2.29	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	5-6087-46052-67-5	\N	1	เจษฎา	\N	ทองดี	1	1	0	0	9	ถนนพหลโยธิน	\N	\N	1001	2558	421	3	2.37	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	4-6164-18609-10-8	\N	3	ศิริพร	\N	มณีรัตน์	2	1	0	0	7	ถนนห้วยแก้ว	\N	\N	1002	2556	423	2	3.73	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	6-2471-73349-98-4	\N	1	ชูเกียรติ	\N	งามดี	1	1	0	0	3	ถนนนวมินทร์	\N	\N	1003	2562	106	2	3.26	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	2-6800-76700-10-6	\N	3	กัญญาณัฐ	\N	สุวรรณภูมิ	2	1	0	0	6	ถนนนวมินทร์	\N	\N	1002	2558	421	2	2.07	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	7-6992-42620-87-2	\N	1	วรพล	\N	ทั่วถึง	1	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	1001	2559	113	2	2.52	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	1-6103-51803-49-2	\N	2	กาญจนา	\N	แสงสว่าง	2	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	1002	2559	113	3	2.49	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	1-4424-87144-58-7	\N	1	ทัศนัย	\N	พงษ์ไพร	1	1	0	0	3	ถนนลาดพร้าว	\N	\N	1003	2560	112	1	2.36	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	5-1344-96516-66-9	\N	1	ธนพัฒน์	\N	เกียรติสกุล	1	1	0	0	9	ถนนพหลโยธิน	\N	\N	1003	2556	423	2	3.37	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	7-5628-67321-86-4	\N	1	ธัชพล	\N	วิไลวรรณ	1	1	0	0	4	ถนนสุรวงศ์	\N	\N	1001	2564	104	3	2.81	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	8-5914-44556-12-9	\N	3	สุมาลี	\N	บุญมี	2	1	0	0	9	ถนนรัตนาธิเบศร์	\N	\N	1001	2559	113	1	3.21	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	1-3755-15377-96-2	\N	2	ศิริพร	\N	วิริยะ	2	1	0	0	10	ถนนบรมราชชนนี	\N	\N	1003	2562	106	3	2.97	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	2-6493-80400-45-9	\N	2	พรทิพย์	\N	วงษ์สุวรรณ	2	1	0	0	6	ถนนประดิษฐ์มนูธรรม	\N	\N	1001	2566	102	2	3.07	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	2-7607-14239-47-8	\N	1	ชาตรี	\N	เพ็งพา	1	1	0	0	3	ถนนชัยพฤกษ์	\N	\N	1002	2566	102	1	3.49	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	8-5466-57626-45-5	\N	1	ณัฐวุฒิ	\N	อินทร์ชัย	1	1	0	0	8	ถนนรัตนาธิเบศร์	\N	\N	1003	2566	102	3	2.51	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	2-6553-41965-83-5	\N	1	วสันต์	\N	ดีสมัย	1	1	0	0	7	ถ.บ้านโป่ง	\N	\N	1001	2562	106	1	2.58	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	7-1045-57618-39-1	\N	2	สุนิสา	\N	รุ่งเรือง	2	1	0	0	3	ถนนบายพาส	\N	\N	1001	2561	111	2	3.47	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	8-1097-38322-59-9	\N	1	เอกพงษ์	\N	บุญรอด	1	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	1002	2559	113	1	2.75	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	1-7077-15769-26-9	\N	3	วรรณภา	\N	พงษ์ไพร	2	1	0	0	2	ถนนอุดรดุษฎี	\N	\N	1001	2559	113	2	2.48	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	3-1961-41097-91-1	\N	2	พิมพ์ชนก	\N	สุขสบาย	2	1	0	0	3	ถนนกลางเมือง	\N	\N	1001	2563	105	1	3.18	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	8-7078-84504-69-6	\N	1	ภูมิพัฒน์	\N	คงพิทักษ์	1	1	0	0	4	ถนนรามคำแหง	\N	\N	1002	2556	423	1	3.38	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	1-3179-70747-54-8	\N	1	ธัชพล	\N	ทองดี	1	1	0	0	5	ถนนห้วยแก้ว	\N	\N	1001	2556	423	3	3.07	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	5-5674-53172-38-9	\N	2	อภิญญา	\N	ทองดี	2	1	0	0	2	ถนนรามคำแหง	\N	\N	1002	2559	113	3	3.11	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	6-9673-37703-46-5	\N	1	วสันต์	\N	ศักดิ์สิทธิ์	1	1	0	0	6	ถนนสุดสาคร	\N	\N	1001	2561	111	3	2.9	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	8-1857-51274-99-7	\N	2	รัตนาภรณ์	\N	คงพิทักษ์	2	1	0	0	7	ถนนพหลโยธิน	\N	\N	1003	2563	105	1	2.25	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	1-8334-11374-47-8	\N	1	รชานนท์	\N	จันทร์แก้ว	1	1	0	0	3	ถนนมาลัยแมน	\N	\N	1002	2558	421	2	3.08	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	1-2163-59081-35-1	\N	2	ณัฐนิชา	\N	ดีสมัย	2	1	0	0	2	ถ.ประชาสามัคคี	\N	\N	1002	2560	112	2	3.01	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	2-6177-65475-16-6	\N	1	ณัฐวรรธน์	\N	สีดา	1	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	1003	2559	113	2	2.99	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	4-6347-50316-66-5	\N	1	ประพันธ์	\N	บุญมี	1	1	0	0	1	ถนนบายพาส	\N	\N	1001	2561	111	2	2.34	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	8-1891-51853-68-2	\N	3	สุมาลี	\N	คงมั่น	2	1	0	0	10	ถนนบรมราชชนนี	\N	\N	1001	2556	423	3	3.88	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	6-7362-26129-80-4	\N	3	อัมพร	\N	มงคล	2	1	0	0	4	ถนนห้วยแก้ว	\N	\N	1003	2558	421	3	2.43	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	1-4043-41835-98-8	\N	3	ปาณิสรา	\N	ประสิทธิ์ผล	2	1	0	0	8	ถนนบรมราชชนนี	\N	\N	1003	2563	105	2	3.37	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	1-6896-66686-72-4	\N	2	นลินทิพย์	\N	พรสวรรค์	2	1	0	0	4	ถนนอ่อนนุช	\N	\N	1003	2561	111	3	2.53	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	3-4446-84124-61-5	\N	1	อนุชา	\N	วังขวา	1	1	0	0	5	ถนนลาดพร้าว	\N	\N	1003	2564	104	1	3.62	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	8-7161-90912-85-3	\N	1	นพรัตน์	\N	บุญมี	1	1	0	0	5	ถนนราษฎร์บูรณะ	\N	\N	1002	2556	423	1	3.63	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	6-3305-16125-27-4	\N	2	กาญจนา	\N	นิ่มนวล	2	1	0	0	3	ถนนสุขุมวิท	\N	\N	1003	2567	101	1	3.58	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	4-3870-77667-45-5	\N	1	สิรภพ	\N	สุดสวย	1	1	0	0	3	ถนนสาทร	\N	\N	1001	2563	105	2	3.23	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	1-8917-53437-51-2	\N	2	ศิริพร	\N	คงพิทักษ์	2	1	0	0	6	ถนนกาญจนาภิเษก	\N	\N	1003	2564	104	1	3.8	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	2-4305-82235-38-2	\N	3	อรณิชา	\N	แสงสว่าง	2	1	0	0	1	ถนนพหลโยธิน	\N	\N	1002	2562	106	2	3.14	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	7-3466-26814-73-8	\N	2	วิมลรัตน์	\N	คงมั่น	2	1	0	0	8	ถ.รัฐพัฒนา	\N	\N	1003	2559	113	1	3.55	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	7-7583-49156-71-1	\N	1	นรวิชญ์	\N	ใจดี	1	1	0	0	8	ถนนพหลโยธิน	\N	\N	1002	2567	101	3	3.94	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	6-6131-32212-89-9	\N	1	นพรัตน์	\N	เกียรติสกุล	1	1	0	0	5	ถนนสรงประภา	\N	\N	1001	2557	422	2	3.6	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	8-5427-12425-96-7	\N	2	กัญญาณัฐ	\N	ยิ้มแย้ม	2	1	0	0	8	ถนนกลางเมือง	\N	\N	1002	2559	113	3	2.11	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	1-8040-30958-11-1	\N	1	ภัคพล	\N	บริบูรณ์	1	1	0	0	4	ถนนสุดสาคร	\N	\N	1002	2562	106	2	3.14	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	2-5632-85192-67-5	\N	1	ธนพัฒน์	\N	เพียรดี	1	1	0	0	6	ถ.บ้านโป่ง	\N	\N	1002	2566	102	2	3.92	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	8-9874-46411-86-2	\N	1	ชนะชัย	\N	พรประเสริฐ	1	1	0	0	5	ถนนโชคชัย	\N	\N	1001	2566	102	3	3.66	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	4-3341-64649-65-5	\N	3	ปัณฑิตา	\N	ปัญญาดี	2	1	0	0	4	ถนนสรงประภา	\N	\N	1002	2566	102	2	3.4	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	2-3571-81834-84-9	\N	1	เอกพงษ์	\N	อินทร์ชัย	1	1	0	0	2	ถนนเพชรเกษม	\N	\N	1003	2564	104	2	2.38	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	2-3989-99791-67-7	\N	3	เพ็ญพักตร์	\N	ศักดิ์สิทธิ์	2	1	0	0	3	ถนนสรงประภา	\N	\N	1002	2556	423	2	2.03	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	3-6587-62126-69-9	\N	1	มานพ	\N	พรประเสริฐ	1	1	0	0	8	ถนนงามวงศ์วาน	\N	\N	1003	2562	106	2	2.6	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	8-1947-53231-94-9	\N	1	ปรเมศวร์	\N	คงมั่น	1	1	0	0	5	ถนนงามวงศ์วาน	\N	\N	1002	2562	106	3	3.09	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	5-7063-62535-49-8	\N	2	ปิยนุช	\N	เจริญชัย	2	1	0	0	10	ถนนนวมินทร์	\N	\N	1003	2560	112	3	2.4	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	8-5412-84366-59-4	\N	2	จิราพร	\N	งามดี	2	1	0	0	9	ถนนสุรวงศ์	\N	\N	1003	2561	111	3	2.97	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	2-1830-81172-17-3	\N	1	ทักษิณ	\N	มงคล	1	1	0	0	7	ถนนบรมราชชนนี	\N	\N	1002	2567	103	1	2.91	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	6-8366-99703-74-7	\N	2	จิราพร	\N	สุขสบาย	2	1	0	0	5	ถนนช้างเผือก	\N	\N	1001	2567	101	2	3.03	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	3-5174-71637-65-5	\N	3	รุ่งอรุณ	\N	วิไลวรรณ	2	1	0	0	1	ถนนพหลโยธิน	\N	\N	1002	2556	423	2	2.7	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	7-9699-27405-47-1	\N	1	วีรชัย	\N	พรประเสริฐ	1	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	1002	2566	102	3	3.68	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	5-5956-44080-18-9	\N	3	นภาพร	\N	หอมหวาน	2	1	0	0	10	ถ.เอกชัย	\N	\N	1002	2558	421	1	2.35	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	7-1278-77182-39-6	\N	2	พิมพ์ชนก	\N	พรสวรรค์	2	1	0	0	8	ถนนลาดพร้าว	\N	\N	1001	2566	102	3	3.11	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	5-5387-30169-37-9	\N	1	กวินท์	\N	มณีรัตน์	1	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	1001	2567	101	1	2.57	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	4-1498-89785-45-2	\N	1	กิตติภณ	\N	พรสวรรค์	1	1	0	0	4	ถนนกาญจนาภิเษก	\N	\N	1003	2557	422	3	2.1	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	8-8978-27685-44-6	\N	1	มานพ	\N	สง่างาม	1	1	0	0	3	ถนนประดิษฐ์มนูธรรม	\N	\N	1002	2560	112	3	2.95	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	5-6206-15536-69-4	\N	2	สุภัสสรา	\N	เกียรติสกุล	2	1	0	0	6	ถนนบายพาส	\N	\N	1002	2563	105	2	3.05	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	4-5115-98713-12-6	\N	2	สุดารัตน์	\N	ดำรงค์	2	1	0	0	10	ถนนประดิษฐ์มนูธรรม	\N	\N	1002	2567	101	3	3.46	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	5-5428-29285-93-1	\N	1	ปรเมศวร์	\N	เพียรดี	1	1	0	0	4	ถนนบรมราชชนนี	\N	\N	1002	2567	101	1	3.58	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	1-8678-35062-49-3	\N	2	ปิยนุช	\N	ชัยมงคล	2	1	0	0	1	ถนนสีลม	\N	\N	1003	2563	105	3	3.68	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	7-8541-57523-88-6	\N	1	สุทธิพงษ์	\N	ทั่วถึง	1	1	0	0	2	ถนนนิมมานเหมินท์	\N	\N	1002	2556	423	2	2.57	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	3-4300-10484-74-9	\N	1	ธนพัฒน์	\N	สกุลดี	1	1	0	0	3	ถนนห้วยแก้ว	\N	\N	1003	2567	103	3	3.14	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	4-3757-66277-13-6	\N	3	ดวงใจ	\N	จันทร์แก้ว	2	1	0	0	9	ถนนบายพาส	\N	\N	1003	2561	111	1	2.64	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	8-4153-10326-59-7	\N	3	รัตนาภรณ์	\N	รุ่งเรือง	2	1	0	0	3	ถนนสาทร	\N	\N	1002	2567	101	3	2.81	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	3-5831-29225-58-6	\N	1	ประพันธ์	\N	วงษ์สุวรรณ	1	1	0	0	6	ถนนนิมมานเหมินท์	\N	\N	1003	2564	104	2	3.17	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	3-4605-95690-70-2	\N	2	เพ็ญพักตร์	\N	รุ่งเรือง	2	1	0	0	8	ถนนโชคชัย	\N	\N	1001	2564	104	1	3.03	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	1-1588-66152-50-5	\N	1	อภิวัฒน์	\N	เพ็งพา	1	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	1001	2559	113	3	3.66	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	5-2156-92197-66-7	\N	1	บุญยิ่ง	\N	ศักดิ์สิทธิ์	1	1	0	0	8	ถนนห้วยแก้ว	\N	\N	1002	2557	422	2	3.16	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	8-4442-70656-75-2	\N	2	กุลธิดา	\N	ปัญญาดี	2	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	1003	2557	422	3	3.37	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	7-3746-63082-80-4	\N	2	ศิริพร	\N	ศักดิ์สิทธิ์	2	1	0	0	9	ถนนเยาวราช	\N	\N	1003	2557	422	2	3.02	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	7-2298-29783-40-7	\N	2	สุนิสา	\N	พรประเสริฐ	2	1	0	0	2	ถนนศรีนครินทร์	\N	\N	1001	2567	103	1	3.43	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	6-2445-81720-79-2	\N	1	วสันต์	\N	ธนาคาร	1	1	0	0	3	ถนนนวมินทร์	\N	\N	1003	2567	103	1	3.34	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	1-7582-60859-86-1	\N	2	นวลจันทร์	\N	วิริยะ	2	1	0	0	2	ถนนรัตนาธิเบศร์	\N	\N	1001	2562	106	3	3.66	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	7-4784-39347-45-9	\N	2	มาลัย	\N	อินทร์ชัย	2	1	0	0	7	ถนนนิมมานเหมินท์	\N	\N	1002	2562	106	3	3.11	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	8-9372-90502-62-9	\N	2	ปัณฑิตา	\N	วังขวา	2	1	0	0	4	ถนนอ่อนนุช	\N	\N	1002	2557	422	2	2.98	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	3-4572-23126-51-6	\N	3	มณีรัตน์	\N	สุขสบาย	2	1	0	0	6	ถนนลาดพร้าว	\N	\N	1002	2567	103	1	3.53	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	4-9463-45893-45-5	\N	2	ลลิตา	\N	สุวรรณภูมิ	2	1	0	0	1	ถนนนิมมานเหมินท์	\N	\N	1001	2559	113	3	2.96	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	8-1842-95380-99-2	\N	2	วาสนา	\N	จันทร์แก้ว	2	1	0	0	3	ถนนสีลม	\N	\N	1001	2559	113	1	2.62	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	7-9746-88871-19-1	\N	2	วรรณภา	\N	ประสิทธิ์ผล	2	1	0	0	10	ถ.ประชาสามัคคี	\N	\N	1003	2567	103	1	2.78	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	5-5374-56813-64-9	\N	3	เพ็ญพักตร์	\N	บุญรอด	2	1	0	0	5	ถนนเยาวราช	\N	\N	1001	2563	105	1	3.28	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	5-1354-18702-65-4	\N	3	กาญจนา	\N	มณีรัตน์	2	1	0	0	3	ถนนห้วยแก้ว	\N	\N	1001	2556	423	3	3.71	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	8-6997-69376-30-3	\N	3	สิริมา	\N	วิริยะ	2	1	0	0	8	ถนนสีลม	\N	\N	1003	2563	105	1	2.71	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	2-6430-83296-57-5	\N	1	ธนพัฒน์	\N	ประสิทธิ์ผล	1	1	0	0	3	ถนนสีลม	\N	\N	1003	2557	422	3	2.08	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	6-5166-80456-41-7	\N	1	ธนาธิป	\N	ขาวสะอาด	1	1	0	0	7	ถนนสุขุมวิท	\N	\N	1001	2566	102	3	3.06	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	3-3004-55269-90-6	\N	3	สิริมา	\N	พันธุ์ดี	2	1	0	0	9	ถนนวิภาวดีรังสิต	\N	\N	1002	2567	101	3	2.88	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	8-1048-54128-11-3	\N	1	วสันต์	\N	กิตติคุณ	1	1	0	0	3	ถนนงามวงศ์วาน	\N	\N	1002	2567	101	1	3.14	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	5-2620-39874-48-5	\N	1	ธัชพล	\N	ดำรงค์	1	1	0	0	8	ถนนบายพาส	\N	\N	1003	2567	101	3	3.75	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	8-5715-13385-26-3	\N	1	สมศักดิ์	\N	ชูศรี	1	1	0	0	9	ถนนสุดสาคร	\N	\N	1002	2560	112	1	3.39	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	6-1484-85384-92-7	\N	2	รุ่งอรุณ	\N	ดีสมัย	2	1	0	0	3	ถนนรามคำแหง	\N	\N	1001	2567	101	2	3.94	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	7-7807-64245-65-2	\N	1	รชานนท์	\N	เจริญชัย	1	1	0	0	1	ถนนสรงประภา	\N	\N	1002	2564	104	1	3.28	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	3-3189-99135-99-4	\N	3	วันวิสา	\N	พงษ์ไพร	2	1	0	0	5	ถนนนวมินทร์	\N	\N	1002	2562	106	1	2.27	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	7-8999-56934-89-1	\N	1	วรากร	\N	คงมั่น	1	1	0	0	2	ถ.เอกชัย	\N	\N	1003	2560	112	2	3.11	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	2-5494-48504-13-3	\N	2	เพ็ญพักตร์	\N	วิไลวรรณ	2	1	0	0	4	ถนนสุรวงศ์	\N	\N	1001	2559	113	2	3.63	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	3-7175-16887-24-9	\N	3	ชลธิชา	\N	ขาวสะอาด	2	1	0	0	7	ถนนสุรวงศ์	\N	\N	1002	2559	113	2	3.76	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	6-7248-90260-91-6	\N	2	ประภา	\N	เจริญชัย	2	1	0	0	6	ถนนราษฎร์บูรณะ	\N	\N	1001	2563	105	3	3.17	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	5-1736-13450-37-9	\N	1	วุฒิพงษ์	\N	สุจริต	1	1	0	0	6	ถนนพหลโยธิน	\N	\N	1002	2567	101	2	3.72	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	4-5441-47820-97-5	\N	1	เอกพงษ์	\N	พรสวรรค์	1	1	0	0	9	ถนนสุดสาคร	\N	\N	1002	2556	423	1	3.46	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	8-4951-40595-18-5	\N	2	นันทพร	\N	บุญรอด	2	1	0	0	6	ถนนกาญจนาภิเษก	\N	\N	1003	2556	423	3	2	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	4-3438-56871-21-2	\N	2	สุมาลี	\N	เกียรติสกุล	2	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	1003	2558	421	2	3.16	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	1-6279-47409-41-8	\N	3	มาลัย	\N	คงมั่น	2	1	0	0	8	ถนนอุดรดุษฎี	\N	\N	1001	2556	423	3	2.02	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	1-2636-80243-71-4	\N	2	ภัทรวดี	\N	แสงสว่าง	2	1	0	0	2	ถนนนิมมานเหมินท์	\N	\N	1003	2558	421	2	3	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	7-8886-80105-62-3	\N	1	มานพ	\N	วงษ์สุวรรณ	1	1	0	0	2	ถนนพหลโยธิน	\N	\N	1002	2561	111	1	2.65	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	7-9593-51953-64-5	\N	2	กัญญา	\N	ศักดิ์สิทธิ์	2	1	0	0	3	ถนนช้างเผือก	\N	\N	1002	2561	111	1	3.31	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	4-5004-19450-57-5	\N	3	วรรณภา	\N	อ่อนน้อม	2	1	0	0	3	ถนนอ่อนนุช	\N	\N	1003	2561	111	1	3.75	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	7-6492-94807-98-6	\N	1	ธัชพล	\N	ทองดี	1	1	0	0	1	ถนนห้วยแก้ว	\N	\N	1001	2558	421	1	2.11	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	3-1447-62915-62-8	\N	1	ดิศรณ์	\N	พันธุ์ดี	1	1	0	0	1	ถนนเพชรเกษม	\N	\N	1003	2558	421	1	2.58	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	2-7583-65628-41-4	\N	3	ชลธิชา	\N	วิไลวรรณ	2	1	0	0	9	ถนนชัยพฤกษ์	\N	\N	1003	2556	423	3	2.28	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	6-4802-86953-26-3	\N	1	ปรเมศวร์	\N	มงคล	1	1	0	0	3	ถนนรัตนาธิเบศร์	\N	\N	1001	2567	101	1	2.55	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	1-2237-24925-36-5	\N	2	นภาพร	\N	อ่อนน้อม	2	1	0	0	9	ถนนนิมมานเหมินท์	\N	\N	1001	2566	102	3	3.61	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	6-3974-77767-58-2	\N	1	วิชญ์พล	\N	ดำรงค์	1	1	0	0	4	ถนนราษฎร์บูรณะ	\N	\N	1001	2562	106	1	3.28	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	6-3068-38387-48-3	\N	1	วรพล	\N	คงพิทักษ์	1	1	0	0	9	ถนนสุดสาคร	\N	\N	1002	2562	106	2	3.36	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	7-8035-35339-44-3	\N	3	สุดารัตน์	\N	สกุลดี	2	1	0	0	1	ถนนมิตรภาพ	\N	\N	1001	2563	105	2	3.17	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	4-5533-96752-83-9	\N	1	ภัคพล	\N	งามดี	1	1	0	0	6	ถนนศรีนครินทร์	\N	\N	1002	2564	104	3	3.83	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	7-7623-58618-52-2	\N	3	พรทิพย์	\N	ประสิทธิ์ผล	2	1	0	0	5	ถ.บ้านโป่ง	\N	\N	1001	2556	423	3	2.36	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	7-7823-49340-23-5	\N	3	รัตนาภรณ์	\N	ธนาคาร	2	1	0	0	8	ถนนกลางเมือง	\N	\N	1001	2564	104	1	3.32	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	8-5436-61617-65-6	\N	1	ปัณณทัต	\N	ประสิทธิ์ผล	1	1	0	0	4	ถนนช้างเผือก	\N	\N	1003	2561	111	1	2.72	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	6-5093-30197-47-4	\N	1	นพรัตน์	\N	ชูศรี	1	1	0	0	7	ถ.บ้านโป่ง	\N	\N	1003	2567	103	1	3.57	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	8-7854-35757-90-9	\N	1	พิพัฒน์	\N	จันทร์แก้ว	1	1	0	0	4	ถนนห้วยแก้ว	\N	\N	1002	2560	112	1	2.31	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	4-1428-64127-22-7	\N	3	สิริมา	\N	รุ่งเรือง	2	1	0	0	9	ถนนชัยพฤกษ์	\N	\N	1003	2562	106	3	3.5	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	2-7803-22606-55-4	\N	3	ดรุณี	\N	ชูศรี	2	1	0	0	9	ถนนบรมราชชนนี	\N	\N	1003	2567	101	3	3.41	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	1-5011-13030-73-4	\N	1	ธัชพล	\N	ธนาคาร	1	1	0	0	8	ถนนสรงประภา	\N	\N	1003	2567	103	3	3.03	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	7-8896-82599-12-9	\N	3	วรรณภา	\N	สุดสวย	2	1	0	0	3	ถนนบายพาส	\N	\N	1001	2561	111	1	2.69	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	4-5879-67936-60-3	\N	2	ดรุณี	\N	ศรีสุข	2	1	0	0	6	ถนนกาญจนาภิเษก	\N	\N	1001	2557	422	2	2.8	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	5-6643-63144-36-4	\N	1	เอกพงษ์	\N	ชูศรี	1	1	0	0	10	ถนนเพชรเกษม	\N	\N	1003	2557	422	2	3.68	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	2-2799-33792-92-7	\N	3	อรณิชา	\N	สุขสบาย	2	1	0	0	7	ถนนวิภาวดีรังสิต	\N	\N	1001	2563	105	3	2.52	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	4-4579-53075-38-2	\N	3	กัญญาณัฐ	\N	มีสุข	2	1	0	0	1	ถนนเพชรเกษม	\N	\N	1003	2557	422	2	3.36	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	4-5458-86690-14-2	\N	2	ภัทรวดี	\N	สุวรรณภูมิ	2	1	0	0	4	ถนนสีลม	\N	\N	1003	2563	105	1	2.8	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	8-4360-99869-45-9	\N	1	กันตภณ	\N	นามมนตรี	1	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	1001	2559	113	3	2.84	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	2-8113-74700-86-4	\N	1	สุทธิพงษ์	\N	บุญรอด	1	1	0	0	1	ถนนงามวงศ์วาน	\N	\N	1003	2559	113	1	3.46	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	2-1408-16233-49-3	\N	2	บุษยา	\N	จันทร์แก้ว	2	1	0	0	1	ถนนชัยพฤกษ์	\N	\N	1002	2563	105	2	3.16	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	1-5037-48270-28-2	\N	2	สุนิสา	\N	ประสิทธิ์ผล	2	1	0	0	4	ถนนเยาวราช	\N	\N	1003	2557	422	3	3.93	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	7-2005-72659-82-2	\N	3	สุดารัตน์	\N	รักษ์ไทย	2	1	0	0	8	ถนนเพชรเกษม	\N	\N	1001	2561	111	2	2.56	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	2-2415-74947-24-4	\N	1	ปิยังกูร	\N	เจริญชัย	1	1	0	0	3	ถนนเพชรเกษม	\N	\N	1001	2558	421	2	3.57	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	2-5740-22060-25-3	\N	2	ณัฐนิชา	\N	ขาวสะอาด	2	1	0	0	9	ถ.รัฐพัฒนา	\N	\N	1002	2557	422	1	3.94	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	7-8805-76856-57-8	\N	2	ชนิดา	\N	กิตติคุณ	2	1	0	0	7	ถนนวิภาวดีรังสิต	\N	\N	1003	2563	105	3	2.43	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	8-5942-90565-24-7	\N	2	กุลธิดา	\N	พงษ์ไพร	2	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	1003	2564	104	1	3.85	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	1-2247-41125-20-6	\N	1	ปัณณทัต	\N	อ่อนน้อม	1	1	0	0	4	ถนนช้างเผือก	\N	\N	1001	2560	112	2	2.57	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	2-7660-81810-42-6	\N	1	รชานนท์	\N	คงพิทักษ์	1	1	0	0	6	ถนนราษฎร์บูรณะ	\N	\N	1003	2562	106	3	2.37	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	6-5636-73774-18-8	\N	3	ธัญชนก	\N	ทั่วถึง	2	1	0	0	10	ถนนนวมินทร์	\N	\N	1002	2564	104	1	2.45	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	4-1956-14014-57-2	\N	3	ปิยนุช	\N	สกุลดี	2	1	0	0	10	ถนนช้างเผือก	\N	\N	1002	2558	421	2	3.01	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	5-3386-34147-67-2	\N	3	ลลิตา	\N	เพียรดี	2	1	0	0	8	ถนนชัยพฤกษ์	\N	\N	1002	2567	103	2	2.86	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	5-7271-11047-70-1	\N	2	จิราพร	\N	งามดี	2	1	0	0	1	ถนนบรมราชชนนี	\N	\N	1003	2557	422	2	2.73	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	7-3949-44167-15-9	\N	3	นวลจันทร์	\N	ศรีสุข	2	1	0	0	8	ถนนเพชรเกษม	\N	\N	1001	2567	103	2	3.12	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	5-2643-73682-27-9	\N	1	ธนภัทร	\N	ยิ้มแย้ม	1	1	0	0	3	ถนนพหลโยธิน	\N	\N	1002	2558	421	3	3.2	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	3-3293-40063-28-9	\N	2	สุนิสา	\N	ดีสมัย	2	1	0	0	3	ถนนศรีนครินทร์	\N	\N	1003	2563	105	1	2.7	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	6-3548-78945-34-6	\N	1	นพรัตน์	\N	รักษ์ไทย	1	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	1002	2558	421	3	2.56	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	5-8411-89343-24-4	\N	1	ธนภัทร	\N	นามมนตรี	1	1	0	0	6	ถนนเพชรเกษม	\N	\N	1001	2567	103	3	3.55	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	8-3385-31591-92-9	\N	1	ปัณณทัต	\N	สุวรรณภูมิ	1	1	0	0	10	ถนนสรงประภา	\N	\N	1003	2567	103	2	2.55	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	1-8608-78706-40-1	\N	1	ภัคพล	\N	พันธุ์ดี	1	1	0	0	3	ถนนนวมินทร์	\N	\N	1001	2560	112	2	3.11	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	6-4974-49489-19-6	\N	1	วรากร	\N	มณีรัตน์	1	1	0	0	3	ถนนโชคชัย	\N	\N	1002	2561	111	3	2.72	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	8-5715-92419-26-9	\N	1	ชัยชนะ	\N	หอมหวาน	1	1	0	0	1	ถนนศรีนครินทร์	\N	\N	1002	2567	103	3	2.94	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	7-4637-55135-73-9	\N	1	ชัยชนะ	\N	วิริยะ	1	1	0	0	1	ถนนสีลม	\N	\N	1003	2561	111	3	2.6	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	8-5105-41398-61-1	\N	2	กัญญา	\N	เพียรดี	2	1	0	0	6	ถนนช้างเผือก	\N	\N	1001	2567	103	1	3.68	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	1-9924-46471-33-1	\N	3	มณีรัตน์	\N	ธนาคาร	2	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	1002	2557	422	3	2.61	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	7-1242-59448-18-1	\N	1	อนุชา	\N	ขาวสะอาด	1	1	0	0	7	ถนนช้างเผือก	\N	\N	1002	2564	104	3	3.29	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	1-2359-62307-50-3	\N	2	พรรษา	\N	อินทร์ชัย	2	1	0	0	8	ถนนมาลัยแมน	\N	\N	1002	2558	421	2	2.89	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	1-3293-56886-38-1	\N	1	วิชญ์พล	\N	รุ่งเรือง	1	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	1003	2567	103	1	2.74	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	7-5845-45304-48-8	\N	1	สุรชัย	\N	สีดา	1	1	0	0	8	ถนนศรีนครินทร์	\N	\N	1002	2566	102	3	2.74	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	5-3852-37864-48-9	\N	3	พิมพ์ชนก	\N	สุจริต	2	1	0	0	1	ถนนลาดพร้าว	\N	\N	1001	2564	104	3	2.45	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	6-5040-62208-86-2	\N	3	กัญญาณัฐ	\N	วังขวา	2	1	0	0	6	ถนนนวมินทร์	\N	\N	1001	2560	112	1	3.44	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	8-7206-11959-30-5	\N	3	ชนิดา	\N	พันธุ์ดี	2	1	0	0	3	ถนนกลางเมือง	\N	\N	1003	2567	103	2	2.51	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	6-5769-57033-33-4	\N	2	วรรณภา	\N	งามดี	2	1	0	0	2	ถนนห้วยแก้ว	\N	\N	1001	2567	103	3	2.46	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	3-8128-61420-33-2	\N	1	คุณากร	\N	เจริญชัย	1	1	0	0	8	ถนนราษฎร์บูรณะ	\N	\N	1001	2563	105	2	2.04	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	1-5948-21404-62-8	\N	1	วุฒิพงษ์	\N	พันธุ์ดี	1	1	0	0	9	ถนนศรีนครินทร์	\N	\N	1001	2561	111	1	3.69	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	7-4439-72238-10-7	\N	1	สมชาย	\N	สุจริต	1	1	0	0	4	ถนนสรงประภา	\N	\N	1001	2561	111	1	3.82	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	1-5949-79682-55-1	\N	2	ประภา	\N	คงมั่น	2	1	0	0	3	ถนนชัยพฤกษ์	\N	\N	1001	2556	423	3	2.31	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	4-4989-37740-57-4	\N	1	รชานนท์	\N	จันทร์แก้ว	1	1	0	0	8	ถ.บ้านโป่ง	\N	\N	1003	2562	106	1	2.21	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	6-8049-23035-58-3	\N	1	ไกรวุฒิ	\N	แสงสว่าง	1	1	0	0	3	ถนนช้างเผือก	\N	\N	1001	2564	104	3	2.24	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	6-6064-10322-67-3	\N	3	จันทร์เพ็ญ	\N	สุดสวย	2	1	0	0	4	ถนนพหลโยธิน	\N	\N	1002	2561	111	3	3.53	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	8-8626-80054-19-5	\N	2	มณีรัตน์	\N	บุญมี	2	1	0	0	6	ถนนบายพาส	\N	\N	1003	2567	103	1	3.93	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	2-5844-56234-35-2	\N	3	ลลิตา	\N	สุขสันต์	2	1	0	0	2	ถ.ประชาสามัคคี	\N	\N	1001	2567	103	1	3.61	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	8-7849-18768-26-1	\N	3	อัมพร	\N	วังขวา	2	1	0	0	10	ถนนราษฎร์บูรณะ	\N	\N	1002	2567	103	1	2.82	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	2-1980-30431-26-4	\N	1	อนุชา	\N	อ่อนน้อม	1	1	0	0	2	ถนนรามคำแหง	\N	\N	1002	2566	102	3	2.58	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	6-5031-27758-29-4	\N	3	กาญจนา	\N	มณีรัตน์	2	1	0	0	8	ถนนรามคำแหง	\N	\N	1002	2567	101	3	3.14	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	5-9398-58186-63-4	\N	2	มาลัย	\N	ใจดี	2	1	0	0	8	ถนนบรมราชชนนี	\N	\N	1001	2560	112	3	3.03	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	1-1473-42091-68-6	\N	1	ศิวกร	\N	มงคล	1	1	0	0	4	ถนนนวมินทร์	\N	\N	1001	2558	421	2	2.39	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	7-6645-88569-94-9	\N	1	ปัณณทัต	\N	สุดสวย	1	1	0	0	7	ถนนบายพาส	\N	\N	1003	2564	104	1	2.46	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	4-9141-64097-53-2	\N	1	ปรเมศวร์	\N	ลือชา	1	1	0	0	6	ถนนสาทร	\N	\N	1003	2557	422	1	2.98	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	7-6785-31452-99-7	\N	1	กิตติภณ	\N	จันทร์แก้ว	1	1	0	0	7	ถนนวิภาวดีรังสิต	\N	\N	1001	2567	101	3	3.81	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	8-3999-46654-50-6	\N	1	ภัคพล	\N	มีสุข	1	1	0	0	4	ถนนสุรวงศ์	\N	\N	1001	2559	113	1	3.61	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	5-9666-67840-75-5	\N	3	ทิพย์สุดา	\N	วิไลวรรณ	2	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	1002	2566	102	2	3.97	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	2-1355-50216-62-3	\N	1	ดิศรณ์	\N	นามมนตรี	1	1	0	0	6	ถนนพหลโยธิน	\N	\N	1003	2557	422	3	2.74	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	6-2799-28742-96-1	\N	2	มาลัย	\N	ดำรงค์	2	1	0	0	7	ถนนสรงประภา	\N	\N	1002	2563	105	2	3.07	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	1-8222-86586-37-5	\N	3	สุนิสา	\N	สมบูรณ์	2	1	0	0	5	ถนนสรงประภา	\N	\N	1003	2563	105	3	2.64	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	6-1071-34385-28-4	\N	1	ปรเมศวร์	\N	ดำรงค์	1	1	0	0	5	ถ.บ้านโป่ง	\N	\N	1001	2557	422	2	3.74	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	3-7120-25232-76-5	\N	2	กัญญา	\N	พันธุ์ดี	2	1	0	0	1	ถ.รัฐพัฒนา	\N	\N	1002	2562	106	3	3.13	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	5-8418-82810-97-3	\N	1	นรวิชญ์	\N	อินทร์ชัย	1	1	0	0	4	ถนนอ่อนนุช	\N	\N	1003	2563	105	3	2.27	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	6-2049-61735-72-7	\N	2	นวลจันทร์	\N	สุดสวย	2	1	0	0	8	ถนนพหลโยธิน	\N	\N	1001	2556	423	3	3.41	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	1-2848-18829-27-3	\N	3	กุลธิดา	\N	ยิ้มแย้ม	2	1	0	0	1	ถนนรัตนาธิเบศร์	\N	\N	1001	2558	421	3	2.85	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	4-7928-69160-96-7	\N	3	วาสนา	\N	บุญมี	2	1	0	0	1	ถนนโชคชัย	\N	\N	1002	2564	104	3	2.57	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	2-4388-59963-11-6	\N	1	อนุชา	\N	บุญรอด	1	1	0	0	5	ถนนวิภาวดีรังสิต	\N	\N	1003	2567	103	2	3.5	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	1-2863-34614-28-5	\N	2	จิตรลดา	\N	มณีรัตน์	2	1	0	0	10	ถนนกลางเมือง	\N	\N	1003	2558	421	2	2.56	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	1-2268-24192-52-5	\N	1	สุทธิพงษ์	\N	คงมั่น	1	1	0	0	7	ถนนรามคำแหง	\N	\N	1002	2567	103	3	3.94	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	1-5683-43460-91-2	\N	2	มณีรัตน์	\N	บุญรอด	2	1	0	0	1	ถนนวิภาวดีรังสิต	\N	\N	1001	2557	422	3	3.47	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	6-2242-37993-52-4	\N	1	กันตภณ	\N	พงษ์ไพร	1	1	0	0	9	ถนนเพชรเกษม	\N	\N	1001	2566	102	2	3.08	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	1-4229-15513-89-1	\N	2	วาสนา	\N	ลือชา	2	1	0	0	2	ถนนสุดสาคร	\N	\N	1002	2561	111	2	2.83	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	1-2494-89717-14-3	\N	3	นภาพร	\N	มีสุข	2	1	0	0	8	ถนนเพชรเกษม	\N	\N	1001	2561	111	2	3.19	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	6-9453-61021-64-9	\N	2	จิตรลดา	\N	ลือชา	2	1	0	0	7	ถนนรามคำแหง	\N	\N	1003	2558	421	2	2.19	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	4-4263-30949-62-2	\N	1	สุทธิพงษ์	\N	ดำรงค์	1	1	0	0	8	ถนนลาดพร้าว	\N	\N	1002	2556	423	2	2.71	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	2-6697-65310-51-8	\N	3	ณัฐนิชา	\N	บุญรอด	2	1	0	0	3	ถนนนวมินทร์	\N	\N	1001	2556	423	1	2.51	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	3-5625-30869-59-7	\N	3	นลินทิพย์	\N	พงษ์ไพร	2	1	0	0	3	ถนนเพชรเกษม	\N	\N	1001	2567	101	3	3.39	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	5-7968-66066-80-8	\N	3	ดวงใจ	\N	ชัยมงคล	2	1	0	0	10	ถนนสาทร	\N	\N	1003	2559	113	1	3.36	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	3-8569-33431-71-7	\N	1	ชูเกียรติ	\N	ดีสมัย	1	1	0	0	7	ถนนประดิษฐ์มนูธรรม	\N	\N	1001	2560	112	3	2.68	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	3-6241-26486-76-6	\N	1	สิรภพ	\N	วิไลวรรณ	1	1	0	0	5	ถนนอุดรดุษฎี	\N	\N	1001	2567	103	3	3.48	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	1-9768-83964-70-3	\N	1	ปัณณทัต	\N	สุขสบาย	1	1	0	0	1	ถ.รัฐพัฒนา	\N	\N	1003	2564	104	1	3.89	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	2-2980-75701-47-3	\N	1	นพรัตน์	\N	วังขวา	1	1	0	0	6	ถนนสรงประภา	\N	\N	1001	2566	102	2	3.2	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	2-3399-19592-16-3	\N	3	นวลจันทร์	\N	ดีสมัย	2	1	0	0	5	ถนนชัยพฤกษ์	\N	\N	1001	2564	104	1	2.22	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	1-6714-96330-71-8	\N	1	ศิวกร	\N	สุจริต	1	1	0	0	8	ถนนเพชรเกษม	\N	\N	1002	2556	423	1	3.78	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	6-7533-62774-68-7	\N	3	สุภัสสรา	\N	จันทร์แก้ว	2	1	0	0	5	ถนนลาดพร้าว	\N	\N	1002	2556	423	3	3.22	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	6-3495-31165-46-3	\N	2	ปิยนุช	\N	ดีสมัย	2	1	0	0	7	ถนนกลางเมือง	\N	\N	1002	2562	106	1	2.03	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	2-2244-43865-41-1	\N	1	ชูเกียรติ	\N	บริบูรณ์	1	1	0	0	8	ถนนสุขุมวิท	\N	\N	1003	2557	422	3	2.36	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	2-6481-74597-91-2	\N	3	ดวงใจ	\N	ลือชา	2	1	0	0	2	ถนนช้างเผือก	\N	\N	1003	2564	104	2	2.29	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	3-7865-11168-13-9	\N	1	เอกพงษ์	\N	สุดสวย	1	1	0	0	1	ถนนสรงประภา	\N	\N	1001	2558	421	1	2.79	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	4-4615-51765-46-9	\N	2	มณีรัตน์	\N	เพียรดี	2	1	0	0	9	ถนนสาทร	\N	\N	1002	2557	422	2	3.2	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	8-2495-43049-59-4	\N	2	ศิริพร	\N	คงพิทักษ์	2	1	0	0	9	ถนนมาลัยแมน	\N	\N	1001	2567	101	2	3.36	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	8-3272-96166-62-7	\N	2	วิมลรัตน์	\N	พรสวรรค์	2	1	0	0	6	ถนนชัยพฤกษ์	\N	\N	1001	2563	105	1	2.18	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	3-9160-97793-26-5	\N	1	พิพัฒน์	\N	ประสิทธิ์ผล	1	1	0	0	1	ถนนลาดพร้าว	\N	\N	1003	2558	421	2	3.72	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	1-2414-49871-95-7	\N	1	อนุชา	\N	ทั่วถึง	1	1	0	0	1	ถนนห้วยแก้ว	\N	\N	1003	2567	101	1	3.32	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	3-9118-25013-61-4	\N	1	มานพ	\N	มณีรัตน์	1	1	0	0	1	ถนนอ่อนนุช	\N	\N	1003	2560	112	2	2.42	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	4-1210-21719-17-1	\N	1	ณัฐวุฒิ	\N	รุ่งเรือง	1	1	0	0	1	ถนนรัตนาธิเบศร์	\N	\N	1003	2558	421	2	3.2	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	5-9711-15879-32-9	\N	1	วรากร	\N	ศักดิ์สิทธิ์	1	1	0	0	4	ถนนช้างเผือก	\N	\N	1002	2564	104	1	3.51	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	4-1808-44407-38-8	\N	3	ชลธิชา	\N	บุญรอด	2	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	1003	2562	106	3	3.37	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	1-9386-20793-27-3	\N	1	ปัณณทัต	\N	สง่างาม	1	1	0	0	7	ถนนเจริญกรุง	\N	\N	1002	2567	103	1	3.16	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	5-8503-10490-54-4	\N	1	สมชาย	\N	มงคล	1	1	0	0	2	ถนนบรมราชชนนี	\N	\N	1003	2561	111	2	3.81	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	4-1137-90330-65-8	\N	1	สมชาย	\N	สุจริต	1	1	0	0	4	ถ.ประชาสามัคคี	\N	\N	1003	2567	101	3	3.67	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	7-4813-72176-62-6	\N	2	อรณิชา	\N	ศักดิ์สิทธิ์	2	1	0	0	1	ถนนเพชรเกษม	\N	\N	1003	2560	112	3	2.62	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	7-3052-96271-77-9	\N	3	ศิริพร	\N	ลือชา	2	1	0	0	4	ถนนมาลัยแมน	\N	\N	1003	2560	112	3	2.99	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	7-3645-70278-61-3	\N	1	ภัคพล	\N	บุญรอด	1	1	0	0	10	ถนนราษฎร์บูรณะ	\N	\N	1003	2558	421	1	2.18	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	1-4190-68660-92-7	\N	1	ภัคพล	\N	สกุลดี	1	1	0	0	2	ถนนสุดสาคร	\N	\N	1002	2562	106	3	3.66	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	1-8598-48198-84-4	\N	2	รัตนาภรณ์	\N	ศักดิ์สิทธิ์	2	1	0	0	6	ถนนนวมินทร์	\N	\N	1003	2563	105	3	3.78	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	3-8107-52299-87-8	\N	1	ปรเมศวร์	\N	วิไลวรรณ	1	1	0	0	7	ถนนวิภาวดีรังสิต	\N	\N	1002	2561	111	2	3.06	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	1-6195-13843-19-5	\N	1	นพรัตน์	\N	สุขสันต์	1	1	0	0	2	ถ.ประชาสามัคคี	\N	\N	1001	2566	102	2	3.94	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	2-3278-87362-55-7	\N	1	ชูเกียรติ	\N	เจริญชัย	1	1	0	0	6	ถนนบรมราชชนนี	\N	\N	1002	2562	106	3	3.17	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	6-1714-10571-87-3	\N	2	กัญญาณัฐ	\N	สุขสันต์	2	1	0	0	5	ถนนกาญจนาภิเษก	\N	\N	1002	2560	112	2	2.08	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	1-4816-94221-12-3	\N	1	คุณากร	\N	มีสุข	1	1	0	0	10	ถนนอ่อนนุช	\N	\N	1003	2566	102	2	3.46	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	2-9309-61304-90-1	\N	1	รัฐนนท์	\N	จันทร์แก้ว	1	1	0	0	8	ถนนกาญจนาภิเษก	\N	\N	1003	2563	105	2	3.27	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	6-3445-33744-30-4	\N	1	สุทธิพงษ์	\N	งามดี	1	1	0	0	4	ถนนมาลัยแมน	\N	\N	1001	2557	422	3	3.29	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	1-1223-75336-91-4	\N	1	รัฐนนท์	\N	ยิ้มแย้ม	1	1	0	0	1	ถนนสรงประภา	\N	\N	1003	2563	105	2	2.34	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	8-6955-41354-70-5	\N	3	ธัญชนก	\N	อ่อนน้อม	2	1	0	0	1	ถนนห้วยแก้ว	\N	\N	1003	2563	105	1	2.52	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	6-7684-98904-73-5	\N	2	ดวงใจ	\N	พรสวรรค์	2	1	0	0	1	ถนนบายพาส	\N	\N	1003	2556	423	2	2.78	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	6-2074-46790-58-7	\N	3	สิริมา	\N	อ่อนน้อม	2	1	0	0	9	ถนนนวมินทร์	\N	\N	1002	2558	421	2	2.44	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	5-4746-96684-55-9	\N	2	มณีรัตน์	\N	เพียรดี	2	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	1003	2561	111	3	2.56	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	3-1480-96900-68-8	\N	2	ศิริพร	\N	สกุลดี	2	1	0	0	6	ถนนเจริญกรุง	\N	\N	1002	2567	103	3	2.76	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	5-5927-41962-65-6	\N	3	พิมพ์ชนก	\N	พงษ์ไพร	2	1	0	0	9	ถนนลาดพร้าว	\N	\N	1001	2560	112	3	3.12	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	3-9716-45276-61-8	\N	3	ณัฐนิชา	\N	วิไลวรรณ	2	1	0	0	3	ถนนพหลโยธิน	\N	\N	1001	2556	423	3	2.06	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	1-8658-68567-39-8	\N	1	เจษฎา	\N	ดีสมัย	1	1	0	0	3	ถนนห้วยแก้ว	\N	\N	1002	2556	423	3	3.52	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	1-2039-65274-27-6	\N	3	สมหญิง	\N	เพียรดี	2	1	0	0	9	ถนนมิตรภาพ	\N	\N	1003	2567	101	1	3.34	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	1-5913-55022-12-3	\N	1	สมชาย	\N	ทองดี	1	1	0	0	9	ถนนเพชรเกษม	\N	\N	1003	2559	113	3	3.39	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	4-4666-74418-89-6	\N	3	สิริมา	\N	อินทร์ชัย	2	1	0	0	4	ถนนบรมราชชนนี	\N	\N	1001	2566	102	2	3.39	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	3-7571-56919-33-8	\N	1	รัฐนนท์	\N	รักษ์ไทย	1	1	0	0	5	ถนนชัยพฤกษ์	\N	\N	1001	2566	102	3	2.54	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	6-9124-39287-77-4	\N	3	แสงดาว	\N	สมบูรณ์	2	1	0	0	9	ถนนมิตรภาพ	\N	\N	1003	2558	421	1	3.38	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	2-4803-52490-22-2	\N	3	วิมลรัตน์	\N	วงษ์สุวรรณ	2	1	0	0	8	ถนนนิมมานเหมินท์	\N	\N	1002	2556	423	1	3.6	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	1-7846-27788-70-3	\N	3	มณีรัตน์	\N	งามดี	2	1	0	0	9	ถนนเพชรเกษม	\N	\N	1003	2563	105	3	2.91	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	3-2423-97529-50-8	\N	2	พรรษา	\N	พงษ์ไพร	2	1	0	0	6	ถนนอุดรดุษฎี	\N	\N	1002	2560	112	2	2.19	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	1-9416-43756-77-2	\N	1	ทัศนัย	\N	สกุลดี	1	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	1002	2559	113	1	3.51	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	2-8069-41522-12-4	\N	2	รัตนาภรณ์	\N	ชูศรี	2	1	0	0	10	ถนนช้างเผือก	\N	\N	1003	2560	112	2	3.14	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	6-9844-28722-26-7	\N	1	ภัคพล	\N	ทั่วถึง	1	1	0	0	8	ถนนสีลม	\N	\N	1002	2560	112	2	2.67	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	1-6055-75808-54-2	\N	1	ธนาธิป	\N	งามดี	1	1	0	0	5	ถนนชัยพฤกษ์	\N	\N	1001	2560	112	1	3.66	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	1-3371-82479-32-4	\N	1	อภิวัฒน์	\N	เกียรติสกุล	1	1	0	0	2	ถนนสุรวงศ์	\N	\N	1003	2567	103	2	2.74	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	2-2805-53415-47-1	\N	3	อรณิชา	\N	เกียรติสกุล	2	1	0	0	5	ถนนเยาวราช	\N	\N	1002	2557	422	2	2.93	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	7-7103-39494-20-1	\N	1	ศุภณัฐ	\N	พรประเสริฐ	1	1	0	0	3	ถ.เอกชัย	\N	\N	1003	2561	111	3	2.74	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	2-8662-89292-26-7	\N	2	สุภัสสรา	\N	วิไลวรรณ	2	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	1001	2559	113	1	3.37	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	2-1877-75984-72-4	\N	2	สิริมา	\N	วิริยะ	2	1	0	0	10	ถนนชัยพฤกษ์	\N	\N	1001	2561	111	1	3.43	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	2-6279-68019-37-8	\N	1	ชนะชัย	\N	ชูศรี	1	1	0	0	7	ถ.เอกชัย	\N	\N	1003	2564	104	2	3.22	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	8-8984-10128-66-5	\N	1	ชูเกียรติ	\N	มณีรัตน์	1	1	0	0	6	ถนนบรมราชชนนี	\N	\N	1002	2563	105	3	3.03	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	3-1096-27161-92-7	\N	2	กุลธิดา	\N	หอมหวาน	2	1	0	0	9	ถนนสุรวงศ์	\N	\N	1002	2564	104	1	2.22	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	1-3786-87915-50-9	\N	2	กัญญา	\N	คงมั่น	2	1	0	0	7	ถ.ประชาสามัคคี	\N	\N	1003	2566	102	3	3.02	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	4-5475-63488-97-8	\N	2	วรรณภา	\N	อ่อนน้อม	2	1	0	0	6	ถนนนิมมานเหมินท์	\N	\N	1001	2561	111	1	3.29	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	2-1731-19898-41-9	\N	1	ปิยังกูร	\N	วังขวา	1	1	0	0	3	ถ.ประชาสามัคคี	\N	\N	1003	2559	113	1	3.58	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	7-1984-23179-79-5	\N	1	วรากร	\N	แสงสว่าง	1	1	0	0	3	ถนนชัยพฤกษ์	\N	\N	1002	2557	422	1	2.49	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	4-3847-14132-80-4	\N	1	ชนะชัย	\N	พงษ์ไพร	1	1	0	0	2	ถนนบายพาส	\N	\N	1003	2566	102	1	3.04	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	1-4892-80447-82-2	\N	1	วรพล	\N	สง่างาม	1	1	0	0	8	ถนนสุรวงศ์	\N	\N	1003	2564	104	1	2.95	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	8-8019-73195-33-1	\N	2	จิตรลดา	\N	บริบูรณ์	2	1	0	0	1	ถนนสุขุมวิท	\N	\N	1003	2560	112	3	3.41	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	1-8483-24960-65-4	\N	2	อรณิชา	\N	หอมหวาน	2	1	0	0	5	ถนนประดิษฐ์มนูธรรม	\N	\N	1003	2566	102	1	3.95	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	6-2325-24434-84-2	\N	3	ณัฐนิชา	\N	จันทร์แก้ว	2	1	0	0	10	ถนนเยาวราช	\N	\N	1001	2566	102	2	2.51	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	7-6638-54358-59-2	\N	3	ทิพย์สุดา	\N	เกียรติสกุล	2	1	0	0	10	ถนนศรีนครินทร์	\N	\N	1002	2566	102	2	2.71	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	2-9208-75598-63-3	\N	3	อัมพร	\N	วงษ์สุวรรณ	2	1	0	0	7	ถนนสุรวงศ์	\N	\N	1001	2560	112	2	3.47	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	8-9911-38673-13-6	\N	2	จิราพร	\N	บุญมี	2	1	0	0	6	ถ.บ้านโป่ง	\N	\N	1003	2557	422	2	3.85	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	5-1762-31741-27-4	\N	1	เจษฎา	\N	จันทร์แก้ว	1	1	0	0	5	ถนนบายพาส	\N	\N	1001	2567	101	3	3.22	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	4-4578-10111-47-2	\N	1	พิพัฒน์	\N	ขาวสะอาด	1	1	0	0	2	ถ.รัฐพัฒนา	\N	\N	1002	2559	113	1	2.99	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	4-2846-88769-60-9	\N	3	ภัทรวดี	\N	สมบูรณ์	2	1	0	0	7	ถนนสาทร	\N	\N	1003	2561	111	2	2.53	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	7-9364-73312-12-4	\N	3	ปาณิสรา	\N	มณีรัตน์	2	1	0	0	7	ถนนประดิษฐ์มนูธรรม	\N	\N	1002	2561	111	2	2.88	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	4-7579-39755-98-2	\N	1	ธนภัทร	\N	มณีรัตน์	1	1	0	0	6	ถนนศรีนครินทร์	\N	\N	1002	2556	423	1	2.97	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	8-1944-60240-52-4	\N	1	ชูเกียรติ	\N	วังขวา	1	1	0	0	5	ถนนงามวงศ์วาน	\N	\N	1003	2567	101	3	3.47	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	8-3790-26814-75-3	\N	1	สิรภพ	\N	แสงสว่าง	1	1	0	0	5	ถ.เอกชัย	\N	\N	1002	2557	422	3	2.19	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	7-1875-72974-52-8	\N	1	คุณากร	\N	ดีสมัย	1	1	0	0	9	ถนนเจริญกรุง	\N	\N	1001	2561	111	3	2.41	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	1-6172-31132-27-2	\N	3	ดรุณี	\N	พันธุ์ดี	2	1	0	0	8	ถนนรามคำแหง	\N	\N	1003	2564	104	2	3.32	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	2-9757-96888-23-1	\N	1	กันตภณ	\N	บุญรอด	1	1	0	0	7	ถนนงามวงศ์วาน	\N	\N	1002	2558	421	2	2.71	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	2-3755-88168-69-6	\N	3	สิริมา	\N	รุ่งเรือง	2	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	1001	2559	113	2	2.4	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	7-4570-73963-81-9	\N	1	เอกพงษ์	\N	งามดี	1	1	0	0	2	ถนนบรมราชชนนี	\N	\N	1002	2567	103	2	3.27	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	1-7421-79520-31-1	\N	1	คุณากร	\N	มงคล	1	1	0	0	2	ถนนสาทร	\N	\N	1003	2561	111	3	3.25	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	3-2882-60989-38-4	\N	1	วุฒิพงษ์	\N	ใจดี	1	1	0	0	7	ถนนรามคำแหง	\N	\N	1002	2556	423	2	2.38	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	1-1743-50694-98-1	\N	1	วรากร	\N	ลือชา	1	1	0	0	4	ถ.เอกชัย	\N	\N	1003	2563	105	2	2.54	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	6-9249-39479-53-7	\N	1	ไกรวุฒิ	\N	สุวรรณภูมิ	1	1	0	0	4	ถนนประดิษฐ์มนูธรรม	\N	\N	1003	2561	111	2	3.13	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	3-6278-54829-23-8	\N	1	อภิวัฒน์	\N	ลือชา	1	1	0	0	5	ถนนงามวงศ์วาน	\N	\N	1002	2557	422	3	3.26	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	3-2741-33880-34-7	\N	1	ณัฐวุฒิ	\N	ศักดิ์สิทธิ์	1	1	0	0	1	ถนนรามคำแหง	\N	\N	1001	2567	101	2	3.8	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	5-6215-40638-22-6	\N	3	พรทิพย์	\N	สุวรรณภูมิ	2	1	0	0	7	ถนนสาทร	\N	\N	1002	2567	101	1	3.58	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	6-1755-95277-85-7	\N	1	ไกรวุฒิ	\N	พงษ์ไพร	1	1	0	0	5	ถนนกลางเมือง	\N	\N	1001	2567	103	3	2.92	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	3-2763-70411-71-4	\N	3	อรณิชา	\N	สีดา	2	1	0	0	6	ถนนบรมราชชนนี	\N	\N	1001	2563	105	3	3.22	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	3-3797-45438-22-9	\N	1	สมศักดิ์	\N	พันธุ์ดี	1	1	0	0	4	ถนนรัตนาธิเบศร์	\N	\N	1001	2561	111	2	2.44	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	1-2542-81339-22-5	\N	2	แสงดาว	\N	สมบูรณ์	2	1	0	0	5	ถนนกาญจนาภิเษก	\N	\N	1003	2559	113	2	2.63	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	1-3577-46636-41-6	\N	1	ศิวกร	\N	งามดี	1	1	0	0	1	ถนนนิมมานเหมินท์	\N	\N	1003	2567	101	1	3.5	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	7-2067-54087-63-5	\N	3	สุนิสา	\N	สุดสวย	2	1	0	0	1	ถนนวิภาวดีรังสิต	\N	\N	1001	2557	422	3	3.47	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	2-4154-71270-14-6	\N	1	พิพัฒน์	\N	กิตติคุณ	1	1	0	0	5	ถนนสรงประภา	\N	\N	1002	2557	422	3	3.08	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	3-7316-19973-95-2	\N	2	ชนิดา	\N	สุจริต	2	1	0	0	1	ถนนอ่อนนุช	\N	\N	1003	2558	421	1	3.02	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	3-1577-93122-32-4	\N	3	นภาพร	\N	นิ่มนวล	2	1	0	0	8	ถนนบายพาส	\N	\N	1002	2566	102	3	3.37	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	4-9802-60295-21-5	\N	3	อัมพร	\N	คงพิทักษ์	2	1	0	0	2	ถนนงามวงศ์วาน	\N	\N	1001	2567	101	3	3.02	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	5-3077-46758-93-3	\N	1	ไกรวุฒิ	\N	สุจริต	1	1	0	0	5	ถนนพหลโยธิน	\N	\N	1001	2563	105	1	3.57	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	4-5913-98414-76-9	\N	2	อัมพร	\N	วิริยะ	2	1	0	0	10	ถนนสีลม	\N	\N	1003	2566	102	2	3.12	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	7-8146-90254-42-1	\N	1	สิรภพ	\N	คงมั่น	1	1	0	0	9	ถนนอุดรดุษฎี	\N	\N	1002	2556	423	1	3.88	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	3-6402-55026-12-8	\N	2	วิมลรัตน์	\N	พันธุ์ดี	2	1	0	0	5	ถนนสาทร	\N	\N	1001	2558	421	1	2.77	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	5-8857-92779-11-4	\N	3	ณัฐนิชา	\N	เพ็งพา	2	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	1003	2567	101	3	3.98	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	8-7633-53009-15-5	\N	3	วิมลรัตน์	\N	คงมั่น	2	1	0	0	8	ถนนรามคำแหง	\N	\N	1002	2564	104	1	3.71	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	8-4477-46014-46-7	\N	1	ธนภัทร	\N	ทองดี	1	1	0	0	7	ถนนเจริญกรุง	\N	\N	1003	2557	422	2	2.55	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	1-7694-23958-68-1	\N	3	อัมพร	\N	ชูศรี	2	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	1003	2561	111	3	2.66	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	4-9578-44171-67-2	\N	1	สิรภพ	\N	นิ่มนวล	1	1	0	0	6	ถนนสุดสาคร	\N	\N	1002	2567	101	1	2.54	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	2-9893-76215-64-1	\N	3	มณีรัตน์	\N	สกุลดี	2	1	0	0	2	ถนนบายพาส	\N	\N	1003	2560	112	1	3.31	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	4-7028-90045-91-7	\N	3	รุ่งอรุณ	\N	หอมหวาน	2	1	0	0	10	ถนนเจริญกรุง	\N	\N	1003	2564	104	1	2.71	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	4-8937-54978-49-1	\N	3	ณัฐนิชา	\N	วิไลวรรณ	2	1	0	0	3	ถนนเยาวราช	\N	\N	1001	2556	423	2	2.82	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	3-6425-68419-25-5	\N	1	นพรัตน์	\N	สกุลดี	1	1	0	0	1	ถนนสรงประภา	\N	\N	1001	2558	421	3	3.07	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	4	10010004	7-5929-77392-19-7	\N	2	วรรณภา	\N	บุญรอด	2	1	0	0	4	ถนนเจริญกรุง	\N	\N	1002	2564	104	2	3.54	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	7-4209-52346-75-6	\N	2	ดรุณี	\N	งามดี	2	1	0	0	4	ถนนสุขุมวิท	\N	\N	1003	2563	105	3	3.74	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	7-6463-21017-88-4	\N	1	ภูมิพัฒน์	\N	สง่างาม	1	1	0	0	1	ถนนวิภาวดีรังสิต	\N	\N	1001	2562	106	2	3.1	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	1-4542-60763-51-7	\N	3	นันทพร	\N	บริบูรณ์	2	1	0	0	3	ถนนรัตนาธิเบศร์	\N	\N	1002	2558	421	2	3.52	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	4-5229-62817-75-7	\N	1	เอกพงษ์	\N	สกุลดี	1	1	0	0	4	ถนนสีลม	\N	\N	1001	2567	103	2	3.42	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	2	10010004	8-7908-21636-71-1	\N	1	ปิยังกูร	\N	ใจดี	1	1	0	0	8	ถนนสีลม	\N	\N	1003	2566	102	1	2.83	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	8-9124-44729-73-6	\N	3	ลลิตา	\N	สุดสวย	2	1	0	0	10	ถนนกาญจนาภิเษก	\N	\N	1001	2567	103	3	3.82	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	3	10010004	4-8309-70253-42-1	\N	2	นวลจันทร์	\N	พันธุ์ดี	2	1	0	0	4	ถ.เอกชัย	\N	\N	1003	2557	422	1	3.17	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	3-1369-72916-63-8	\N	3	พรรษา	\N	ศักดิ์สิทธิ์	2	1	0	0	6	ถนนบรมราชชนนี	\N	\N	1002	2564	104	1	2.68	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	3	10010004	8-4402-95424-36-1	\N	3	จิตรลดา	\N	สุวรรณภูมิ	2	1	0	0	10	ถนนรัตนาธิเบศร์	\N	\N	1001	2559	113	1	2.15	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	7-7104-62222-55-9	\N	1	ชัยชนะ	\N	วังขวา	1	1	0	0	3	ถนนสุรวงศ์	\N	\N	1001	2567	101	2	3.61	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	5	10010004	7-6987-42243-53-3	\N	3	สุมาลี	\N	ชัยมงคล	2	1	0	0	4	ถนนสรงประภา	\N	\N	1001	2567	101	2	3.48	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	1-2289-19193-17-4	\N	2	อัมพร	\N	ยิ้มแย้ม	2	1	0	0	5	ถนนกลางเมือง	\N	\N	1003	2558	421	1	2.52	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	5	10010004	7-6150-20531-21-9	\N	2	ชลธิชา	\N	คงพิทักษ์	2	1	0	0	2	ถนนห้วยแก้ว	\N	\N	1003	2559	113	3	3.14	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	5-8706-68809-64-2	\N	1	เอกพงษ์	\N	มีสุข	1	1	0	0	9	ถนนมาลัยแมน	\N	\N	1002	2559	113	2	2.15	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	7-7281-81769-28-1	\N	2	รุ่งอรุณ	\N	นามมนตรี	2	1	0	0	6	ถนนสรงประภา	\N	\N	1003	2560	112	3	3.17	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	2-5525-31505-99-4	\N	3	จิราพร	\N	คงพิทักษ์	2	1	0	0	4	ถนนพหลโยธิน	\N	\N	1003	2562	106	1	3.05	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	4	10010004	1-6169-46469-71-4	\N	1	สุทธิพงษ์	\N	วังขวา	1	1	0	0	10	ถนนนวมินทร์	\N	\N	1001	2566	102	2	3.86	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	2-9715-60927-58-1	\N	2	ธัญชนก	\N	ใจดี	2	1	0	0	5	ถ.บ้านโป่ง	\N	\N	1002	2562	106	2	2.13	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	6-3746-44229-68-5	\N	2	ลลิตา	\N	คงมั่น	2	1	0	0	5	ถนนสรงประภา	\N	\N	1003	2564	104	1	2.66	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	3-4701-76132-71-4	\N	1	ชินดนัย	\N	วิไลวรรณ	1	1	0	0	6	ถนนบรมราชชนนี	\N	\N	1003	2560	112	2	2.21	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	4-7004-20007-74-4	\N	3	สุนิสา	\N	กิตติคุณ	2	1	0	0	1	ถนนชัยพฤกษ์	\N	\N	1002	2566	102	1	2.81	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	2-6722-37530-89-9	\N	3	วาสนา	\N	ดีสมัย	2	1	0	0	9	ถนนกลางเมือง	\N	\N	1002	2567	101	2	3.3	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	5	10010004	1-9560-49791-96-2	\N	1	อนุชา	\N	ศรีสุข	1	1	0	0	3	ถนนประดิษฐ์มนูธรรม	\N	\N	1002	2557	422	3	2.66	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	1	10010004	3-4524-80521-36-2	\N	3	เกวลิน	\N	พรสวรรค์	2	1	0	0	10	ถนนสีลม	\N	\N	1003	2556	423	2	2.92	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	1	10010004	4-9730-18523-43-7	\N	2	บุษยา	\N	ศักดิ์สิทธิ์	2	1	0	0	4	ถนนเยาวราช	\N	\N	1003	2556	423	3	2.11	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	3	10010004	6-8590-41740-16-2	\N	1	สมศักดิ์	\N	คงพิทักษ์	1	1	0	0	3	ถนนงามวงศ์วาน	\N	\N	1001	2557	422	1	2.21	10	กรุงเทพมหานคร	ดอนเมือง	สีกัน
2569	1	1	10010004	7-2443-35774-41-2	\N	3	นันทพร	\N	ดีสมัย	2	1	0	0	6	ถนนมิตรภาพ	\N	\N	1002	2562	106	1	2.59	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	2	10010004	5-5863-11345-67-8	\N	2	กุลธิดา	\N	ใจดี	2	1	0	0	9	ถนนบรมราชชนนี	\N	\N	1002	2566	102	1	2.78	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
2569	1	4	10010004	5-6125-51912-68-7	\N	1	ณัฐพล	\N	นิ่มนวล	1	1	0	0	7	ถนนสุรวงศ์	\N	\N	1003	2561	111	2	3.31	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010004	3-7661-90461-86-5	\N	3	ชนิดา	\N	ศรีสุข	2	1	0	0	6	ถนนชัยพฤกษ์	\N	\N	1003	2567	103	3	3.26	10	กรุงเทพมหานคร	ดอนเมือง	สนามบิน
2569	1	2	10010005	1-9144-69505-53-6	\N	1	ศุภณัฐ	\N	สุวรรณภูมิ	1	1	0	0	9	ถนนสรงประภา	\N	\N	4103	2560	112	3	2.49	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	6-7515-72612-92-9	\N	1	ดิศรณ์	\N	เจริญชัย	1	1	0	0	5	ถนนวิภาวดีรังสิต	\N	\N	4102	2561	111	2	2.59	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	2-2639-89580-74-2	\N	3	พิมพ์ชนก	\N	ศักดิ์สิทธิ์	2	1	0	0	8	ถ.เอกชัย	\N	\N	4105	2564	104	2	3.69	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	8-8135-24209-79-4	\N	3	วิมลรัตน์	\N	ลือชา	2	1	0	0	8	ถนนบายพาส	\N	\N	4101	2562	106	1	3.98	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	5-3706-54440-36-2	\N	2	ทิพย์สุดา	\N	รักษ์ไทย	2	1	0	0	7	ถนนกาญจนาภิเษก	\N	\N	4105	2567	103	2	2.37	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	8-5458-67668-66-7	\N	1	คุณากร	\N	งามดี	1	1	0	0	6	ถนนบายพาส	\N	\N	4102	2562	106	3	2.67	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	5-4444-93708-49-4	\N	2	มาลัย	\N	ลือชา	2	1	0	0	7	ถนนนวมินทร์	\N	\N	4101	2559	113	2	2.61	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	3-1043-86318-44-1	\N	3	รุ่งอรุณ	\N	จันทร์แก้ว	2	1	0	0	8	ถนนสุดสาคร	\N	\N	4103	2566	102	3	2.76	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	8-3047-16678-94-1	\N	1	พิพัฒน์	\N	ศรีสุข	1	1	0	0	2	ถนนรามคำแหง	\N	\N	4103	2564	104	2	3.27	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	5-4938-96928-19-5	\N	3	นวลจันทร์	\N	บริบูรณ์	2	1	0	0	9	ถ.เอกชัย	\N	\N	4104	2564	104	2	3.31	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	5-2701-39261-53-5	\N	1	ธนาธิป	\N	สุวรรณภูมิ	1	1	0	0	8	ถนนนิมมานเหมินท์	\N	\N	4103	2556	423	3	2.67	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	6-3484-41167-28-9	\N	1	ธัชพล	\N	บุญรอด	1	1	0	0	6	ถนนกลางเมือง	\N	\N	4103	2558	421	2	2.43	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	5-8992-57464-74-2	\N	2	กัญญา	\N	สุขสันต์	2	1	0	0	7	ถนนสุดสาคร	\N	\N	4105	2564	104	2	3.54	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	4-7726-31973-40-4	\N	1	อภิวัฒน์	\N	ธนาคาร	1	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	4105	2567	101	3	3.46	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	1	10010005	8-2573-43355-73-8	\N	1	พิพัฒน์	\N	มณีรัตน์	1	1	0	0	4	ถนนวิภาวดีรังสิต	\N	\N	4104	2560	112	2	2.8	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	4-9180-47145-57-7	\N	1	นพรัตน์	\N	สุวรรณภูมิ	1	1	0	0	1	ถนนรามคำแหง	\N	\N	4103	2567	103	2	3.99	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	6-1511-96383-15-2	\N	2	ณัฐนิชา	\N	คงพิทักษ์	2	1	0	0	8	ถนนลาดพร้าว	\N	\N	4104	2557	422	1	2.16	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	3-9667-50973-50-2	\N	3	พรรษา	\N	ดำรงค์	2	1	0	0	7	ถนนชัยพฤกษ์	\N	\N	4101	2567	101	3	3.15	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	5	10010005	7-8293-62665-96-4	\N	1	เอกพงษ์	\N	พรสวรรค์	1	1	0	0	6	ถนนอ่อนนุช	\N	\N	4103	2561	111	1	3.4	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	8-1946-69566-26-3	\N	2	ศิริพร	\N	เกียรติสกุล	2	1	0	0	9	ถนนนวมินทร์	\N	\N	4103	2557	422	3	2.82	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	2-4176-90228-10-2	\N	1	กันตภณ	\N	สง่างาม	1	1	0	0	5	ถนนอ่อนนุช	\N	\N	4101	2562	106	1	3.6	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	4-8081-63108-96-4	\N	1	ไกรวุฒิ	\N	บริบูรณ์	1	1	0	0	6	ถ.เอกชัย	\N	\N	4103	2567	101	2	3.45	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	1-1844-69805-96-4	\N	2	ลลิตา	\N	สุดสวย	2	1	0	0	6	ถนนอุดรดุษฎี	\N	\N	4103	2567	101	1	2.79	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	6-3973-97738-63-4	\N	2	กัญญา	\N	เจริญชัย	2	1	0	0	8	ถนนเยาวราช	\N	\N	4101	2558	421	1	3.95	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	2-2449-26548-96-3	\N	1	อภิวัฒน์	\N	วิริยะ	1	1	0	0	4	ถนนราษฎร์บูรณะ	\N	\N	4105	2561	111	2	3.89	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	2-2772-86753-72-9	\N	1	สิรภพ	\N	ยิ้มแย้ม	1	1	0	0	10	ถนนชัยพฤกษ์	\N	\N	4102	2566	102	1	3.71	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	5-7185-58798-99-4	\N	3	เพ็ญพักตร์	\N	ประสิทธิ์ผล	2	1	0	0	3	ถนนกลางเมือง	\N	\N	4103	2560	112	2	3.26	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	6-2398-38027-58-8	\N	3	อภิญญา	\N	ใจดี	2	1	0	0	4	ถนนโชคชัย	\N	\N	4101	2561	111	1	3.64	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	2-4545-68269-64-9	\N	1	ณัฐวรรธน์	\N	ชัยมงคล	1	1	0	0	5	ถนนเพชรเกษม	\N	\N	4102	2567	101	1	3.33	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	2-5276-96753-76-4	\N	2	ศิริพร	\N	หอมหวาน	2	1	0	0	4	ถนนสุรวงศ์	\N	\N	4104	2558	421	1	2.06	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	4-7376-11496-35-1	\N	2	อภิญญา	\N	จันทร์แก้ว	2	1	0	0	9	ถ.เอกชัย	\N	\N	4101	2558	421	2	2.34	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	8-2076-93428-63-3	\N	1	เอกพงษ์	\N	คงพิทักษ์	1	1	0	0	2	ถ.บ้านโป่ง	\N	\N	4103	2558	421	2	2.84	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	1-5911-23497-74-7	\N	1	กิตติภณ	\N	พันธุ์ดี	1	1	0	0	10	ถนนสีลม	\N	\N	4105	2567	103	3	2.91	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	4	10010005	7-5205-90577-64-8	\N	1	วิชญ์พล	\N	ปัญญาดี	1	1	0	0	5	ถนนเพชรเกษม	\N	\N	4102	2566	102	2	3.48	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	7-5098-84596-14-8	\N	1	ธัชพล	\N	ทองดี	1	1	0	0	1	ถนนสีลม	\N	\N	4103	2557	422	3	3.36	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	2-2132-58989-81-2	\N	3	อรณิชา	\N	ปัญญาดี	2	1	0	0	4	ถนนสุดสาคร	\N	\N	4101	2566	102	2	3.52	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	2-6441-42322-18-4	\N	1	มานพ	\N	ประสิทธิ์ผล	1	1	0	0	7	ถนนสรงประภา	\N	\N	4104	2558	421	2	2.55	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	1-9356-69702-56-5	\N	3	รัตนาภรณ์	\N	ธนาคาร	2	1	0	0	9	ถนนพหลโยธิน	\N	\N	4101	2557	422	1	2.23	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	5-4147-99449-89-2	\N	1	ไกรวุฒิ	\N	อินทร์ชัย	1	1	0	0	1	ถนนมาลัยแมน	\N	\N	4102	2562	106	3	2.46	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	5-7183-85223-37-6	\N	2	ลลิตา	\N	พรสวรรค์	2	1	0	0	2	ถนนสุขุมวิท	\N	\N	4103	2557	422	2	2.62	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	4-4103-21374-83-6	\N	1	เอกพงษ์	\N	วงษ์สุวรรณ	1	1	0	0	6	ถนนโชคชัย	\N	\N	4103	2562	106	1	2.3	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	8-2334-73692-99-1	\N	2	ดรุณี	\N	อินทร์ชัย	2	1	0	0	4	ถนนลาดพร้าว	\N	\N	4103	2563	105	2	2.2	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	7-1078-53248-21-7	\N	3	สุนิสา	\N	แสงสว่าง	2	1	0	0	5	ถนนนวมินทร์	\N	\N	4105	2562	106	1	2.26	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	8-7310-83218-43-2	\N	1	ทัศนัย	\N	ยิ้มแย้ม	1	1	0	0	9	ถ.รัฐพัฒนา	\N	\N	4105	2561	111	2	2.58	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	1	10010005	4-6081-52545-93-8	\N	3	พรรษา	\N	เพียรดี	2	1	0	0	4	ถนนบรมราชชนนี	\N	\N	4104	2556	423	1	2.78	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	7-8392-53690-73-5	\N	2	ประภา	\N	ทองดี	2	1	0	0	6	ถนนรามคำแหง	\N	\N	4102	2556	423	1	2.53	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	8-4558-25344-79-2	\N	1	พิพัฒน์	\N	บุญรอด	1	1	0	0	6	ถนนบายพาส	\N	\N	4103	2567	101	1	3.38	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	6-5897-72563-62-2	\N	1	ชาตรี	\N	มงคล	1	1	0	0	2	ถนนเพชรเกษม	\N	\N	4103	2560	112	2	2.1	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	6-5750-98291-54-7	\N	1	สุรชัย	\N	ดำรงค์	1	1	0	0	6	ถ.รัฐพัฒนา	\N	\N	4104	2557	422	2	3.76	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	4-5850-76441-53-5	\N	1	ธนพัฒน์	\N	ดำรงค์	1	1	0	0	1	ถนนสาทร	\N	\N	4104	2557	422	1	2.77	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	7-1186-66868-58-3	\N	1	ไกรวุฒิ	\N	วิริยะ	1	1	0	0	7	ถนนงามวงศ์วาน	\N	\N	4103	2559	113	3	3.72	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	8-8220-69797-66-6	\N	1	คุณากร	\N	บุญมี	1	1	0	0	8	ถนนลาดพร้าว	\N	\N	4104	2558	421	2	2.07	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	8-4010-68201-18-2	\N	1	สุทธิพงษ์	\N	ดำรงค์	1	1	0	0	1	ถ.ประชาสามัคคี	\N	\N	4104	2567	101	2	2.83	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	3-1532-63328-79-3	\N	1	สมชาย	\N	ศรีสุข	1	1	0	0	5	ถนนอ่อนนุช	\N	\N	4102	2560	112	3	2.84	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	4-5132-46690-58-1	\N	1	วิชญ์พล	\N	ดีสมัย	1	1	0	0	7	ถนนสุขุมวิท	\N	\N	4102	2567	101	1	2.82	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	3-4124-54698-66-9	\N	3	ดรุณี	\N	วังขวา	2	1	0	0	7	ถนนห้วยแก้ว	\N	\N	4102	2564	104	2	3.3	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	8-1795-14326-58-5	\N	1	ไกรวุฒิ	\N	ขาวสะอาด	1	1	0	0	5	ถนนเจริญกรุง	\N	\N	4101	2558	421	3	2.69	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	1-5193-31852-56-6	\N	3	วิมลรัตน์	\N	สง่างาม	2	1	0	0	5	ถนนชัยพฤกษ์	\N	\N	4103	2556	423	1	2.23	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	6-6456-13914-71-9	\N	1	ณัฐวุฒิ	\N	พงษ์ไพร	1	1	0	0	7	ถนนประดิษฐ์มนูธรรม	\N	\N	4104	2562	106	2	3.94	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	1	10010005	3-3765-26035-41-2	\N	3	บุษยา	\N	มณีรัตน์	2	1	0	0	8	ถนนลาดพร้าว	\N	\N	4102	2566	102	1	3.58	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	4-3158-80771-70-9	\N	1	ทักษิณ	\N	วังขวา	1	1	0	0	8	ถนนราษฎร์บูรณะ	\N	\N	4103	2566	102	2	3.95	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	7-3845-85533-24-8	\N	2	กุลธิดา	\N	หอมหวาน	2	1	0	0	10	ถนนสุดสาคร	\N	\N	4102	2557	422	3	2.72	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	1-8716-10588-12-6	\N	2	สุดารัตน์	\N	สกุลดี	2	1	0	0	2	ถนนลาดพร้าว	\N	\N	4101	2557	422	1	3.52	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	1-3410-99273-30-1	\N	1	คุณากร	\N	กิตติคุณ	1	1	0	0	2	ถ.บ้านโป่ง	\N	\N	4103	2563	105	3	2.16	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	3-2116-17281-44-7	\N	3	สุดารัตน์	\N	นามมนตรี	2	1	0	0	7	ถนนสรงประภา	\N	\N	4101	2566	102	2	3.29	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	8-5142-46146-31-1	\N	2	ชนิดา	\N	สง่างาม	2	1	0	0	4	ถนนสุดสาคร	\N	\N	4101	2562	106	1	2.81	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	4-4304-11755-83-6	\N	1	สุรชัย	\N	บุญรอด	1	1	0	0	9	ถ.บ้านโป่ง	\N	\N	4103	2560	112	3	3.09	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	1-7983-16419-21-5	\N	1	ปัณณทัต	\N	สุดสวย	1	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	4105	2567	101	2	3.3	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	4	10010005	6-9194-23070-89-8	\N	1	วิชญ์พล	\N	บุญมี	1	1	0	0	1	ถนนเพชรเกษม	\N	\N	4104	2559	113	1	2.54	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	8-3166-13631-89-3	\N	2	ปัณฑิตา	\N	ดำรงค์	2	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	4104	2557	422	3	3.96	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	6-3069-41231-39-3	\N	1	กิตติภณ	\N	ศรีสุข	1	1	0	0	10	ถ.ประชาสามัคคี	\N	\N	4105	2560	112	3	3.45	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	4	10010005	3-2689-55045-78-6	\N	1	กันตภณ	\N	ดำรงค์	1	1	0	0	6	ถนนรามคำแหง	\N	\N	4102	2566	102	3	3.01	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	5-3701-12542-69-6	\N	1	ภัคพล	\N	สุขสันต์	1	1	0	0	8	ถนนนิมมานเหมินท์	\N	\N	4102	2561	111	3	3	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	7-3596-60525-26-6	\N	1	พิพัฒน์	\N	สมบูรณ์	1	1	0	0	10	ถนนบรมราชชนนี	\N	\N	4103	2566	102	2	3.74	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	8-8365-40885-92-7	\N	1	อนุชา	\N	ใจดี	1	1	0	0	8	ถ.เอกชัย	\N	\N	4102	2559	113	3	3.15	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	6-5985-91610-69-9	\N	1	ทัศนัย	\N	หอมหวาน	1	1	0	0	8	ถนนราษฎร์บูรณะ	\N	\N	4103	2556	423	3	2.61	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	4-9495-98650-92-1	\N	3	ทิพย์สุดา	\N	ศรีสุข	2	1	0	0	3	ถนนรัตนาธิเบศร์	\N	\N	4103	2557	422	3	3.7	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	7-1828-92114-13-1	\N	1	กันตภณ	\N	บุญรอด	1	1	0	0	10	ถนนวิภาวดีรังสิต	\N	\N	4101	2556	423	1	2.59	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	7-3088-47746-31-7	\N	1	ไกรวุฒิ	\N	ใจดี	1	1	0	0	7	ถนนสรงประภา	\N	\N	4104	2557	422	2	2.46	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	4-1869-88044-20-5	\N	1	ประพันธ์	\N	หอมหวาน	1	1	0	0	1	ถนนเพชรเกษม	\N	\N	4105	2558	421	1	2.44	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	1	10010005	3-7488-50729-18-5	\N	3	นันทพร	\N	พงษ์ไพร	2	1	0	0	8	ถนนช้างเผือก	\N	\N	4101	2556	423	2	2.37	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	5	10010005	4-4562-53248-88-9	\N	2	ดรุณี	\N	สุขสบาย	2	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	4101	2566	102	2	2.69	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	7-7806-73084-71-2	\N	2	รัตนาภรณ์	\N	ดำรงค์	2	1	0	0	6	ถนนสุรวงศ์	\N	\N	4105	2562	106	3	3.52	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	4-7597-52525-11-1	\N	1	ดิศรณ์	\N	เพ็งพา	1	1	0	0	4	ถนนชัยพฤกษ์	\N	\N	4104	2567	103	3	2.74	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	7-2106-94531-49-5	\N	1	สุทธิพงษ์	\N	ทองดี	1	1	0	0	3	ถ.ประชาสามัคคี	\N	\N	4101	2557	422	2	3.68	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	3-5072-26376-61-8	\N	3	นลินทิพย์	\N	วิไลวรรณ	2	1	0	0	10	ถนนชัยพฤกษ์	\N	\N	4103	2566	102	3	3.88	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	4-4218-50078-39-7	\N	1	เอกพงษ์	\N	สกุลดี	1	1	0	0	10	ถนนสุขุมวิท	\N	\N	4104	2564	104	2	3.9	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	8-4644-53827-68-4	\N	2	ชนิดา	\N	ทั่วถึง	2	1	0	0	4	ถนนโชคชัย	\N	\N	4105	2558	421	3	2.69	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	4	10010005	4-4411-16615-33-4	\N	1	วิชญ์พล	\N	พงษ์ไพร	1	1	0	0	7	ถนนนิมมานเหมินท์	\N	\N	4101	2560	112	1	2.55	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	6-4127-70114-30-1	\N	1	ธนาธิป	\N	รักษ์ไทย	1	1	0	0	4	ถนนสีลม	\N	\N	4103	2559	113	2	2.04	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	3-6351-22561-13-8	\N	3	ปัณฑิตา	\N	ใจดี	2	1	0	0	2	ถนนกลางเมือง	\N	\N	4104	2559	113	1	2.5	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	3	10010005	1-5479-29907-29-5	\N	3	ชนิดา	\N	แสงสว่าง	2	1	0	0	6	ถนนสุดสาคร	\N	\N	4105	2566	102	3	4	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	2-3156-52040-39-9	\N	2	ชลธิชา	\N	ชูศรี	2	1	0	0	1	ถ.บ้านโป่ง	\N	\N	4105	2556	423	2	3.63	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	4-6080-90116-42-2	\N	1	มานพ	\N	วงษ์สุวรรณ	1	1	0	0	10	ถ.เอกชัย	\N	\N	4102	2563	105	1	2.7	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	2-7427-66654-39-3	\N	1	ชาตรี	\N	สุดสวย	1	1	0	0	9	ถนนสรงประภา	\N	\N	4104	2560	112	2	2.99	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	1	10010005	2-9789-96131-56-7	\N	2	สุนิสา	\N	มณีรัตน์	2	1	0	0	4	ถนนห้วยแก้ว	\N	\N	4104	2561	111	3	2.94	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	6-1680-47901-29-1	\N	1	ธนภัทร	\N	สง่างาม	1	1	0	0	6	ถนนประดิษฐ์มนูธรรม	\N	\N	4101	2560	112	2	3.88	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	5	10010005	2-6014-34883-97-4	\N	3	วาสนา	\N	เพียรดี	2	1	0	0	7	ถนนสุขุมวิท	\N	\N	4104	2567	101	2	3.19	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	1	10010005	5-7841-22589-16-4	\N	1	เอกพงษ์	\N	งามดี	1	1	0	0	10	ถนนชัยพฤกษ์	\N	\N	4105	2566	102	1	2.57	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	7-2877-60577-41-9	\N	2	วาสนา	\N	บุญรอด	2	1	0	0	9	ถนนรามคำแหง	\N	\N	4105	2562	106	1	2.56	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	6-7888-88103-15-6	\N	3	วาสนา	\N	วังขวา	2	1	0	0	1	ถนนบายพาส	\N	\N	4105	2567	103	1	3.15	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	8-3557-73999-30-1	\N	2	จิราพร	\N	เจริญชัย	2	1	0	0	9	ถนนรามคำแหง	\N	\N	4104	2563	105	3	2.07	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	5-1290-71093-76-4	\N	2	ลลิตา	\N	ยิ้มแย้ม	2	1	0	0	1	ถนนนวมินทร์	\N	\N	4102	2561	111	1	2.83	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	6-2691-94088-42-6	\N	1	ณัฐพล	\N	สง่างาม	1	1	0	0	5	ถนนประดิษฐ์มนูธรรม	\N	\N	4104	2559	113	2	3.9	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	3	10010005	1-8123-59665-77-9	\N	1	รชานนท์	\N	บริบูรณ์	1	1	0	0	7	ถ.ประชาสามัคคี	\N	\N	4101	2564	104	2	3.07	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	6-8063-15955-54-6	\N	3	ชลธิชา	\N	งามดี	2	1	0	0	7	ถนนสาทร	\N	\N	4104	2564	104	1	2.96	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	3-1266-14243-27-6	\N	2	นลินทิพย์	\N	วิริยะ	2	1	0	0	9	ถนนมิตรภาพ	\N	\N	4101	2557	422	1	3.18	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	1-4277-23031-58-8	\N	2	เกวลิน	\N	พงษ์ไพร	2	1	0	0	9	ถ.เอกชัย	\N	\N	4104	2563	105	2	3.59	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	8-3518-11653-23-3	\N	1	มานพ	\N	ธนาคาร	1	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	4102	2560	112	1	2.74	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	1-6604-48769-85-1	\N	1	ประพันธ์	\N	ปัญญาดี	1	1	0	0	9	ถนนลาดพร้าว	\N	\N	4103	2567	101	2	2.54	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	8-3213-50613-58-2	\N	1	สุทธิพงษ์	\N	มงคล	1	1	0	0	7	ถนนสาทร	\N	\N	4104	2556	423	3	2.92	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	1-1450-13920-84-2	\N	1	ชินดนัย	\N	พรสวรรค์	1	1	0	0	5	ถนนสีลม	\N	\N	4103	2561	111	3	2.6	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	5-2742-67367-82-7	\N	3	รัตนาภรณ์	\N	นิ่มนวล	2	1	0	0	6	ถนนกาญจนาภิเษก	\N	\N	4102	2566	102	2	3.54	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	6-2634-78402-87-7	\N	3	ประภา	\N	รักษ์ไทย	2	1	0	0	3	ถนนชัยพฤกษ์	\N	\N	4105	2564	104	2	3.45	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	4	10010005	3-5092-14896-26-4	\N	3	นันทพร	\N	สง่างาม	2	1	0	0	5	ถนนลาดพร้าว	\N	\N	4103	2558	421	1	2.01	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	6-9497-83906-15-5	\N	3	นภาพร	\N	มีสุข	2	1	0	0	2	ถนนเจริญกรุง	\N	\N	4101	2563	105	2	2.16	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	7-1711-81075-24-3	\N	1	ชูเกียรติ	\N	วิริยะ	1	1	0	0	4	ถนนสรงประภา	\N	\N	4101	2556	423	1	2.83	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	7-4173-64563-20-6	\N	3	ปิยนุช	\N	สง่างาม	2	1	0	0	3	ถ.เอกชัย	\N	\N	4103	2562	106	3	3.23	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	1-3371-30980-43-9	\N	3	เพ็ญพักตร์	\N	สุขสันต์	2	1	0	0	3	ถนนเยาวราช	\N	\N	4105	2564	104	2	2.75	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	6-1680-39669-19-2	\N	2	กุลธิดา	\N	พงษ์ไพร	2	1	0	0	9	ถนนลาดพร้าว	\N	\N	4104	2559	113	2	2.15	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	2-5072-97757-83-7	\N	1	วีรชัย	\N	สุจริต	1	1	0	0	1	ถนนบายพาส	\N	\N	4104	2567	101	1	3.88	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	1	10010005	2-2670-86042-88-3	\N	1	ภูมิพัฒน์	\N	หอมหวาน	1	1	0	0	6	ถนนบายพาส	\N	\N	4104	2559	113	3	3.14	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	4-5742-18308-15-4	\N	1	พิพัฒน์	\N	สีดา	1	1	0	0	5	ถนนบรมราชชนนี	\N	\N	4104	2563	105	3	3.1	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	2-6112-11272-53-2	\N	2	กัญญาณัฐ	\N	งามดี	2	1	0	0	4	ถนนราษฎร์บูรณะ	\N	\N	4101	2562	106	1	2.22	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	1-9230-57337-63-1	\N	2	สมหญิง	\N	มีสุข	2	1	0	0	10	ถนนกาญจนาภิเษก	\N	\N	4105	2561	111	2	2.76	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	8-9627-37876-18-1	\N	1	วีรชัย	\N	บริบูรณ์	1	1	0	0	4	ถนนเพชรเกษม	\N	\N	4101	2563	105	3	3.64	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	3-8499-53007-94-8	\N	3	มณีรัตน์	\N	นามมนตรี	2	1	0	0	10	ถนนกาญจนาภิเษก	\N	\N	4103	2558	421	1	3.89	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	8-5350-43852-89-9	\N	1	เจษฎา	\N	สีดา	1	1	0	0	8	ถนนพหลโยธิน	\N	\N	4103	2560	112	1	2.43	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	5-2457-34356-90-7	\N	1	ปัณณทัต	\N	คงพิทักษ์	1	1	0	0	5	ถนนงามวงศ์วาน	\N	\N	4101	2562	106	2	3.5	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	8-6744-40637-18-9	\N	1	วีรชัย	\N	มณีรัตน์	1	1	0	0	1	ถนนมิตรภาพ	\N	\N	4102	2560	112	2	3.52	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	7-6444-48708-62-2	\N	2	จิราพร	\N	วงษ์สุวรรณ	2	1	0	0	3	ถนนห้วยแก้ว	\N	\N	4101	2560	112	1	3.99	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	8-5761-78295-61-8	\N	1	ธัชพล	\N	ทองดี	1	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	4104	2556	423	1	2.12	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	4-7640-23962-13-1	\N	3	สมหญิง	\N	วิริยะ	2	1	0	0	8	ถ.รัฐพัฒนา	\N	\N	4103	2556	423	1	2.93	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	6-6078-88055-35-4	\N	1	ทัศนัย	\N	ใจดี	1	1	0	0	1	ถ.ประชาสามัคคี	\N	\N	4104	2564	104	1	3.38	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	1	10010005	7-1853-14785-45-1	\N	1	รัฐนนท์	\N	ใจดี	1	1	0	0	3	ถนนบรมราชชนนี	\N	\N	4104	2559	113	3	3.41	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	3	10010005	5-4726-40456-39-9	\N	3	วิมลรัตน์	\N	วงษ์สุวรรณ	2	1	0	0	5	ถนนมาลัยแมน	\N	\N	4103	2567	103	3	2.96	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	1-4458-40688-56-4	\N	2	ทิพย์สุดา	\N	อินทร์ชัย	2	1	0	0	1	ถนนรัตนาธิเบศร์	\N	\N	4105	2567	101	2	3.66	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	2-8825-94881-68-4	\N	2	เพ็ญพักตร์	\N	เจริญชัย	2	1	0	0	2	ถ.รัฐพัฒนา	\N	\N	4104	2562	106	1	3.44	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	3-4212-83420-54-9	\N	1	สุทธิพงษ์	\N	ขาวสะอาด	1	1	0	0	7	ถนนช้างเผือก	\N	\N	4104	2558	421	2	3.01	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	2-5272-20255-40-5	\N	1	ทักษิณ	\N	รักษ์ไทย	1	1	0	0	10	ถนนอ่อนนุช	\N	\N	4104	2559	113	3	2.91	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	7-1096-57879-56-9	\N	1	ทัศนัย	\N	ลือชา	1	1	0	0	2	ถ.เอกชัย	\N	\N	4105	2560	112	2	3.87	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010009	2-3423-60647-51-6	\N	1	อนุชา	\N	พรประเสริฐ	1	1	0	0	2	ถ.เอกชัย	\N	\N	9203	2558	421	2	3.19	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010005	2-7366-27858-53-1	\N	1	ณัฐวุฒิ	\N	บริบูรณ์	1	1	0	0	7	ถนนประดิษฐ์มนูธรรม	\N	\N	4105	2563	105	1	3.76	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	4	10010005	8-1255-23320-47-6	\N	1	ประพันธ์	\N	งามดี	1	1	0	0	6	ถ.บ้านโป่ง	\N	\N	4103	2557	422	2	2.8	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	2-9863-61789-60-3	\N	1	วิชญ์พล	\N	คงพิทักษ์	1	1	0	0	6	ถนนห้วยแก้ว	\N	\N	4102	2567	101	3	2.7	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	3-7380-17024-10-1	\N	1	ไกรวุฒิ	\N	สุขสันต์	1	1	0	0	2	ถนนรามคำแหง	\N	\N	4101	2560	112	1	3.24	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	8-4154-83642-43-5	\N	1	ศุภณัฐ	\N	ปัญญาดี	1	1	0	0	10	ถนนโชคชัย	\N	\N	4103	2564	104	1	2.95	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	3-4165-79580-48-7	\N	1	ปรเมศวร์	\N	วงษ์สุวรรณ	1	1	0	0	10	ถนนรัตนาธิเบศร์	\N	\N	4102	2563	105	1	3.35	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	5-9670-26366-73-8	\N	2	กาญจนา	\N	ดีสมัย	2	1	0	0	4	ถนนมาลัยแมน	\N	\N	4102	2562	106	1	2.53	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	3-3288-12751-62-4	\N	3	ชนิดา	\N	ใจดี	2	1	0	0	2	ถนนเจริญกรุง	\N	\N	4105	2562	106	1	3.98	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	1	10010005	4-1476-30387-34-7	\N	2	วิมลรัตน์	\N	ลือชา	2	1	0	0	5	ถนนรามคำแหง	\N	\N	4104	2567	103	3	3.33	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	2-7780-70613-65-5	\N	2	จิตรลดา	\N	สกุลดี	2	1	0	0	1	ถนนสุรวงศ์	\N	\N	4105	2561	111	2	3.84	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	1	10010005	4-3943-54995-27-9	\N	1	วิชญ์พล	\N	ธนาคาร	1	1	0	0	3	ถนนสุดสาคร	\N	\N	4105	2560	112	3	3.14	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	6-3710-34444-50-3	\N	2	ภัทรวดี	\N	เจริญชัย	2	1	0	0	10	ถนนมาลัยแมน	\N	\N	4105	2563	105	2	3.17	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	7-9882-67017-74-2	\N	3	ปาณิสรา	\N	สุจริต	2	1	0	0	2	ถนนงามวงศ์วาน	\N	\N	4105	2557	422	1	3.6	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	1-6250-83653-73-8	\N	2	พรทิพย์	\N	ทองดี	2	1	0	0	2	ถนนช้างเผือก	\N	\N	4104	2564	104	1	3.29	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	8-9694-72771-88-1	\N	3	ดวงใจ	\N	คงพิทักษ์	2	1	0	0	3	ถนนมิตรภาพ	\N	\N	4101	2559	113	3	3.78	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	8-3757-25234-62-3	\N	1	อนุชา	\N	รักษ์ไทย	1	1	0	0	7	ถนนสุดสาคร	\N	\N	4101	2563	105	2	3.91	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	1-3870-91590-50-6	\N	1	นรวิชญ์	\N	รักษ์ไทย	1	1	0	0	10	ถ.บ้านโป่ง	\N	\N	4102	2566	102	3	2.95	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	8-6174-55384-18-3	\N	3	พรทิพย์	\N	ธนาคาร	2	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	4105	2567	103	3	3.7	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	4	10010005	7-8471-11553-37-9	\N	2	แสงดาว	\N	ใจดี	2	1	0	0	7	ถนนชัยพฤกษ์	\N	\N	4101	2558	421	3	2.43	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	5-3627-36907-36-1	\N	3	จิราพร	\N	สกุลดี	2	1	0	0	1	ถนนนวมินทร์	\N	\N	4101	2564	104	1	2.86	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	3-3721-92349-42-9	\N	1	ประพันธ์	\N	ประสิทธิ์ผล	1	1	0	0	3	ถนนโชคชัย	\N	\N	4102	2567	101	3	3.92	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	4-2363-32513-91-8	\N	2	พรทิพย์	\N	พรสวรรค์	2	1	0	0	4	ถนนอุดรดุษฎี	\N	\N	4101	2567	101	2	3.52	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	3-1107-18395-88-8	\N	3	ประภา	\N	บุญรอด	2	1	0	0	1	ถนนประดิษฐ์มนูธรรม	\N	\N	4103	2561	111	1	2.2	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	8-8043-37438-90-7	\N	3	อรณิชา	\N	หอมหวาน	2	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	4101	2561	111	3	3.49	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	1-1300-57635-20-1	\N	1	ทักษิณ	\N	สีดา	1	1	0	0	9	ถนนรามคำแหง	\N	\N	4103	2563	105	2	2.18	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	4-1780-11686-36-7	\N	3	ดวงใจ	\N	วังขวา	2	1	0	0	1	ถ.ประชาสามัคคี	\N	\N	4102	2557	422	2	3.75	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	4-1046-34956-95-5	\N	1	ปรเมศวร์	\N	พงษ์ไพร	1	1	0	0	3	ถนนกาญจนาภิเษก	\N	\N	4103	2563	105	1	3.49	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	3-1493-89448-24-7	\N	1	เจษฎา	\N	ชัยมงคล	1	1	0	0	7	ถนนสีลม	\N	\N	4102	2564	104	1	3.97	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	8-6006-11212-41-4	\N	1	ภัคพล	\N	สุขสันต์	1	1	0	0	1	ถนนเยาวราช	\N	\N	4104	2561	111	2	3.71	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	5-8607-10561-13-9	\N	3	อภิญญา	\N	ใจดี	2	1	0	0	5	ถนนวิภาวดีรังสิต	\N	\N	4101	2560	112	1	2.87	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	3-7764-32276-76-1	\N	2	กัญญา	\N	จันทร์แก้ว	2	1	0	0	10	ถนนสรงประภา	\N	\N	4103	2556	423	2	2.81	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	7-7810-22938-34-2	\N	2	ภัทรวดี	\N	สุวรรณภูมิ	2	1	0	0	6	ถนนราษฎร์บูรณะ	\N	\N	4101	2559	113	1	3.31	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	1-6314-75957-80-4	\N	2	ทิพย์สุดา	\N	สุดสวย	2	1	0	0	8	ถ.ประชาสามัคคี	\N	\N	4102	2567	101	1	3.49	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	3-6568-98652-35-6	\N	3	นลินทิพย์	\N	นามมนตรี	2	1	0	0	1	ถนนเพชรเกษม	\N	\N	4101	2566	102	2	3.99	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	7-3974-70687-67-9	\N	1	รัฐนนท์	\N	ชัยมงคล	1	1	0	0	9	ถนนนวมินทร์	\N	\N	4102	2559	113	2	3.01	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	1-4898-12604-42-6	\N	1	ธัชพล	\N	ทองดี	1	1	0	0	9	ถนนโชคชัย	\N	\N	4102	2557	422	2	2.55	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	7-2104-50566-26-3	\N	1	สมศักดิ์	\N	งามดี	1	1	0	0	10	ถนนสีลม	\N	\N	4105	2556	423	1	3.67	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	1-6340-56219-82-7	\N	3	ดวงใจ	\N	สุดสวย	2	1	0	0	8	ถนนห้วยแก้ว	\N	\N	4103	2558	421	3	3.76	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	4-1300-50035-52-8	\N	2	ศิริพร	\N	จันทร์แก้ว	2	1	0	0	7	ถนนชัยพฤกษ์	\N	\N	4102	2556	423	3	3.59	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	6-9693-84768-69-1	\N	3	ปาณิสรา	\N	สง่างาม	2	1	0	0	2	ถนนมิตรภาพ	\N	\N	4101	2559	113	2	2	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	7-1995-11017-75-4	\N	1	ธนาธิป	\N	ศรีสุข	1	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	4102	2564	104	2	3.48	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	4-1115-74991-45-7	\N	2	แสงดาว	\N	บุญมี	2	1	0	0	2	ถนนรามคำแหง	\N	\N	4105	2559	113	3	3.17	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	3-8643-23779-91-6	\N	1	วรพล	\N	สุขสันต์	1	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	4105	2558	421	3	2.96	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	3-9410-57906-92-9	\N	1	นรวิชญ์	\N	พรประเสริฐ	1	1	0	0	10	ถนนโชคชัย	\N	\N	4104	2557	422	3	3.35	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	4-1838-84510-11-1	\N	2	วาสนา	\N	บุญรอด	2	1	0	0	8	ถนนสุรวงศ์	\N	\N	4103	2567	103	3	3.04	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	5-5533-50977-69-5	\N	3	มาลัย	\N	นิ่มนวล	2	1	0	0	5	ถนนกาญจนาภิเษก	\N	\N	4105	2561	111	3	3.38	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	3-7317-93918-53-5	\N	1	กิตติภณ	\N	มีสุข	1	1	0	0	4	ถนนนิมมานเหมินท์	\N	\N	4104	2567	101	1	3.62	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	1	10010005	6-9444-37433-88-9	\N	2	มณีรัตน์	\N	สุดสวย	2	1	0	0	6	ถนนรัตนาธิเบศร์	\N	\N	4104	2561	111	3	2.67	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	3	10010005	4-9140-53236-63-9	\N	3	จิตรลดา	\N	เกียรติสกุล	2	1	0	0	2	ถนนบายพาส	\N	\N	4105	2561	111	2	3.11	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	4-1930-68046-93-2	\N	3	ปิยนุช	\N	ปัญญาดี	2	1	0	0	8	ถ.รัฐพัฒนา	\N	\N	4102	2563	105	3	2.08	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	4-7355-86528-30-3	\N	2	ภัทรวดี	\N	วิไลวรรณ	2	1	0	0	4	ถนนอ่อนนุช	\N	\N	4101	2560	112	2	3.02	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	6-3128-82656-52-1	\N	2	วิมลรัตน์	\N	พงษ์ไพร	2	1	0	0	3	ถนนสีลม	\N	\N	4102	2567	101	3	3.38	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	4-6137-97945-52-2	\N	1	ทัศนัย	\N	บุญมี	1	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	4104	2563	105	1	2.32	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	4-5388-73186-72-2	\N	1	สิรภพ	\N	คงพิทักษ์	1	1	0	0	5	ถนนอุดรดุษฎี	\N	\N	4101	2567	101	1	3.95	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	8-1686-29503-14-1	\N	2	ปัณฑิตา	\N	วังขวา	2	1	0	0	7	ถนนรามคำแหง	\N	\N	4103	2561	111	2	2.82	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	6-5490-71617-60-2	\N	2	ปาณิสรา	\N	ดีสมัย	2	1	0	0	3	ถนนเพชรเกษม	\N	\N	4104	2563	105	2	3.87	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	1-7856-52588-13-8	\N	1	บุญยิ่ง	\N	คงพิทักษ์	1	1	0	0	7	ถนนเพชรเกษม	\N	\N	4101	2566	102	2	3.52	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	1-6974-60620-47-5	\N	1	ดิศรณ์	\N	รักษ์ไทย	1	1	0	0	7	ถนนประดิษฐ์มนูธรรม	\N	\N	4105	2556	423	3	3.42	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	6-6455-16691-26-7	\N	2	นลินทิพย์	\N	หอมหวาน	2	1	0	0	4	ถนนช้างเผือก	\N	\N	4103	2556	423	2	3.62	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	5-4545-40420-92-3	\N	3	พิมพ์ชนก	\N	กิตติคุณ	2	1	0	0	8	ถนนมาลัยแมน	\N	\N	4104	2558	421	3	3.6	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	1	10010005	7-1579-13831-76-3	\N	1	สุทธิพงษ์	\N	สีดา	1	1	0	0	4	ถนนสุดสาคร	\N	\N	4105	2562	106	2	3.36	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	1	10010005	3-3452-18135-82-8	\N	2	สุมาลี	\N	สกุลดี	2	1	0	0	6	ถนนช้างเผือก	\N	\N	4105	2562	106	1	3.89	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	8-1389-18799-53-2	\N	1	ธัชพล	\N	จันทร์แก้ว	1	1	0	0	3	ถนนลาดพร้าว	\N	\N	4104	2564	104	1	2.98	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	3	10010005	8-8150-88529-70-3	\N	1	นรวิชญ์	\N	ชูศรี	1	1	0	0	2	ถนนบายพาส	\N	\N	4102	2557	422	2	3.22	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	4-2188-88154-30-7	\N	1	วรพล	\N	ใจดี	1	1	0	0	10	ถนนชัยพฤกษ์	\N	\N	4105	2561	111	3	2.63	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	3-3839-64775-15-1	\N	1	ธนภัทร	\N	มงคล	1	1	0	0	9	ถนนสรงประภา	\N	\N	4103	2566	102	1	3.22	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	8-1887-51360-46-9	\N	1	ธนพัฒน์	\N	อินทร์ชัย	1	1	0	0	6	ถ.บ้านโป่ง	\N	\N	4104	2558	421	3	2.56	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	1-2296-31942-63-9	\N	2	รัตนาภรณ์	\N	แสงสว่าง	2	1	0	0	1	ถนนวิภาวดีรังสิต	\N	\N	4104	2564	104	1	2.49	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	5-9045-63523-11-7	\N	3	สุนิสา	\N	เกียรติสกุล	2	1	0	0	1	ถนนอุดรดุษฎี	\N	\N	4105	2560	112	2	2.27	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	4-8422-82104-69-5	\N	2	ลลิตา	\N	สุดสวย	2	1	0	0	8	ถ.บ้านโป่ง	\N	\N	4103	2567	103	1	2.85	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	8-8506-16928-65-2	\N	3	พิมพ์ชนก	\N	สุขสบาย	2	1	0	0	3	ถนนโชคชัย	\N	\N	4105	2558	421	2	2.64	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	3-9399-29218-61-2	\N	3	นันทพร	\N	รักษ์ไทย	2	1	0	0	7	ถนนเยาวราช	\N	\N	4104	2560	112	1	3.59	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	3	10010005	2-9453-65606-14-6	\N	1	กวินท์	\N	มณีรัตน์	1	1	0	0	7	ถนนสุดสาคร	\N	\N	4101	2556	423	1	3.73	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	6-2050-28919-69-9	\N	1	ชินดนัย	\N	ใจดี	1	1	0	0	4	ถนนรามคำแหง	\N	\N	4104	2567	101	2	4	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	4-7112-98113-97-5	\N	1	ทัศนัย	\N	งามดี	1	1	0	0	2	ถนนสุดสาคร	\N	\N	4103	2562	106	3	3.37	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	5-1323-78458-66-1	\N	1	ศุภณัฐ	\N	ดำรงค์	1	1	0	0	2	ถ.เอกชัย	\N	\N	4105	2561	111	3	3.2	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	4	10010005	1-8856-71255-93-2	\N	1	อนุชา	\N	วิริยะ	1	1	0	0	1	ถ.เอกชัย	\N	\N	4104	2556	423	1	2.73	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	8-7214-69377-99-3	\N	3	วรรณภา	\N	อินทร์ชัย	2	1	0	0	5	ถนนมาลัยแมน	\N	\N	4102	2558	421	3	3.16	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	1-1839-98642-70-1	\N	1	บุญยิ่ง	\N	แสงสว่าง	1	1	0	0	2	ถ.บ้านโป่ง	\N	\N	4103	2566	102	1	2.55	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	5-8758-31426-97-4	\N	2	ณัฐนิชา	\N	สุขสบาย	2	1	0	0	10	ถนนศรีนครินทร์	\N	\N	4103	2559	113	1	2.7	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	8-5407-94989-68-6	\N	1	ศุภณัฐ	\N	สุขสบาย	1	1	0	0	4	ถนนอุดรดุษฎี	\N	\N	4102	2560	112	2	2.73	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	7-5225-97680-93-3	\N	3	จิตรลดา	\N	ทั่วถึง	2	1	0	0	1	ถนนวิภาวดีรังสิต	\N	\N	4103	2560	112	1	2.69	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	5-1644-99120-56-2	\N	1	ธัชพล	\N	พันธุ์ดี	1	1	0	0	4	ถนนสุรวงศ์	\N	\N	4101	2559	113	3	2.42	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	8-7214-79936-24-7	\N	2	เพ็ญพักตร์	\N	มีสุข	2	1	0	0	1	ถนนเจริญกรุง	\N	\N	4104	2558	421	3	3.15	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	1-6950-78283-48-7	\N	3	เกวลิน	\N	สง่างาม	2	1	0	0	9	ถนนโชคชัย	\N	\N	4101	2561	111	2	3.28	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	5	10010005	4-6528-75970-61-3	\N	1	กันตภณ	\N	นามมนตรี	1	1	0	0	5	ถนนลาดพร้าว	\N	\N	4105	2557	422	1	3.03	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	1	10010005	7-4425-33941-43-6	\N	3	ลลิตา	\N	หอมหวาน	2	1	0	0	4	ถนนห้วยแก้ว	\N	\N	4103	2566	102	3	3.43	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	2-1929-77905-57-2	\N	1	กวินท์	\N	ทั่วถึง	1	1	0	0	9	ถนนเยาวราช	\N	\N	4105	2556	423	1	3.8	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	6-4643-31750-19-4	\N	3	แสงดาว	\N	วิริยะ	2	1	0	0	6	ถนนมาลัยแมน	\N	\N	4105	2567	103	3	3.99	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	1	10010005	4-5505-79713-11-1	\N	1	ธนพัฒน์	\N	เพียรดี	1	1	0	0	3	ถนนชัยพฤกษ์	\N	\N	4102	2556	423	3	2.91	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	1-6487-53500-47-9	\N	2	ปาณิสรา	\N	สุวรรณภูมิ	2	1	0	0	3	ถนนเจริญกรุง	\N	\N	4105	2557	422	3	3.86	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	5-8708-99533-42-9	\N	2	กัญญา	\N	วังขวา	2	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	4105	2564	104	1	3.74	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	2-8893-81780-42-8	\N	2	นภาพร	\N	พันธุ์ดี	2	1	0	0	3	ถนนบรมราชชนนี	\N	\N	4102	2567	101	1	3.9	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	5-6638-28881-89-3	\N	2	อัมพร	\N	บริบูรณ์	2	1	0	0	7	ถ.ประชาสามัคคี	\N	\N	4102	2559	113	2	3.07	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	6-5803-46540-52-9	\N	3	เพ็ญพักตร์	\N	ชูศรี	2	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	4105	2564	104	2	3.89	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	1	10010005	3-4490-64519-10-6	\N	2	ชลธิชา	\N	นามมนตรี	2	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	4101	2561	111	3	3.87	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	5-7174-42662-76-1	\N	1	อนุชา	\N	บริบูรณ์	1	1	0	0	2	ถนนชัยพฤกษ์	\N	\N	4103	2562	106	3	3.16	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	6-7670-25575-18-6	\N	3	ปิยนุช	\N	ธนาคาร	2	1	0	0	7	ถนนประดิษฐ์มนูธรรม	\N	\N	4103	2556	423	3	2.48	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	7-6493-90385-42-9	\N	2	อรณิชา	\N	สุดสวย	2	1	0	0	1	ถนนห้วยแก้ว	\N	\N	4102	2564	104	2	2.25	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	5-4953-42515-16-4	\N	1	ชนะชัย	\N	เจริญชัย	1	1	0	0	8	ถนนศรีนครินทร์	\N	\N	4101	2563	105	3	2.26	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	6-7854-34648-18-2	\N	3	ชลธิชา	\N	ยิ้มแย้ม	2	1	0	0	3	ถนนงามวงศ์วาน	\N	\N	4102	2563	105	2	2.91	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	8-9840-16224-60-7	\N	1	ปิยังกูร	\N	สุดสวย	1	1	0	0	2	ถนนห้วยแก้ว	\N	\N	4101	2564	104	3	3.73	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	6-5857-20473-76-1	\N	3	มณีรัตน์	\N	วิริยะ	2	1	0	0	3	ถนนประดิษฐ์มนูธรรม	\N	\N	4104	2559	113	1	2.71	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	7-8090-86546-15-6	\N	1	ชาตรี	\N	บุญมี	1	1	0	0	10	ถนนกาญจนาภิเษก	\N	\N	4101	2562	106	3	3.05	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	5	10010005	5-8356-14719-52-3	\N	3	มาลัย	\N	สมบูรณ์	2	1	0	0	1	ถนนสุรวงศ์	\N	\N	4105	2567	101	1	3.99	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	8-2493-31965-36-3	\N	1	บุญยิ่ง	\N	อินทร์ชัย	1	1	0	0	1	ถนนสาทร	\N	\N	4102	2562	106	3	3.11	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	7-3231-66030-79-6	\N	3	นภาพร	\N	พันธุ์ดี	2	1	0	0	3	ถ.เอกชัย	\N	\N	4102	2566	102	3	3.22	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	1-9287-73323-67-9	\N	1	คุณากร	\N	บริบูรณ์	1	1	0	0	4	ถนนกาญจนาภิเษก	\N	\N	4104	2557	422	3	2.49	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	5-6684-93441-57-8	\N	2	กัญญาณัฐ	\N	รุ่งเรือง	2	1	0	0	4	ถนนช้างเผือก	\N	\N	4102	2567	103	1	3.68	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	1-1916-43382-52-4	\N	2	ธัญชนก	\N	อ่อนน้อม	2	1	0	0	6	ถนนเจริญกรุง	\N	\N	4102	2567	103	2	3.36	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	3-3788-82188-54-8	\N	3	จันทร์เพ็ญ	\N	คงมั่น	2	1	0	0	1	ถนนนิมมานเหมินท์	\N	\N	4101	2561	111	2	2.6	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	7-9539-89119-99-4	\N	1	สิรภพ	\N	ทองดี	1	1	0	0	10	ถ.ประชาสามัคคี	\N	\N	4102	2563	105	2	2.68	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	2-6893-86517-63-5	\N	2	นวลจันทร์	\N	พันธุ์ดี	2	1	0	0	7	ถ.รัฐพัฒนา	\N	\N	4101	2561	111	2	3.06	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	5-9436-97975-43-7	\N	1	คุณากร	\N	ประสิทธิ์ผล	1	1	0	0	8	ถนนสีลม	\N	\N	4103	2560	112	3	2.02	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	3-5643-81350-87-6	\N	1	ธนาธิป	\N	วังขวา	1	1	0	0	6	ถนนนวมินทร์	\N	\N	4102	2560	112	1	3.93	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	5-6124-86373-85-5	\N	3	ดวงใจ	\N	มณีรัตน์	2	1	0	0	3	ถนนมาลัยแมน	\N	\N	4101	2562	106	1	2.48	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	5	10010005	1-2394-26878-16-4	\N	3	ปัณฑิตา	\N	รุ่งเรือง	2	1	0	0	4	ถนนโชคชัย	\N	\N	4101	2559	113	3	2.65	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	5	10010005	7-3355-81342-38-4	\N	1	อนุชา	\N	ศรีสุข	1	1	0	0	6	ถนนอุดรดุษฎี	\N	\N	4102	2560	112	2	2.18	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	2-6996-38633-36-8	\N	1	ณัฐวุฒิ	\N	ศักดิ์สิทธิ์	1	1	0	0	5	ถนนอ่อนนุช	\N	\N	4101	2567	103	3	3.41	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	8-2161-51781-58-6	\N	3	จิราพร	\N	มณีรัตน์	2	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	4102	2567	103	2	2.5	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	6-7026-13331-53-6	\N	3	พรรษา	\N	สุวรรณภูมิ	2	1	0	0	4	ถนนบายพาส	\N	\N	4104	2562	106	3	2.69	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	6-5689-19739-81-4	\N	1	สุทธิพงษ์	\N	วังขวา	1	1	0	0	10	ถนนมิตรภาพ	\N	\N	4101	2558	421	1	2.6	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	1-8424-97652-77-9	\N	1	อนุชา	\N	วิไลวรรณ	1	1	0	0	3	ถนนงามวงศ์วาน	\N	\N	4102	2566	102	1	3.71	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	2-5904-59055-72-5	\N	3	นวลจันทร์	\N	จันทร์แก้ว	2	1	0	0	5	ถนนห้วยแก้ว	\N	\N	4101	2567	103	3	3.48	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	7-5293-70716-35-1	\N	1	ณัฐพล	\N	พรสวรรค์	1	1	0	0	9	ถนนประดิษฐ์มนูธรรม	\N	\N	4102	2567	103	3	2.44	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	3-2500-32089-46-5	\N	1	พิพัฒน์	\N	แสงสว่าง	1	1	0	0	1	ถนนศรีนครินทร์	\N	\N	4102	2558	421	3	3.72	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	1-5104-21829-32-2	\N	1	ชูเกียรติ	\N	สกุลดี	1	1	0	0	9	ถนนลาดพร้าว	\N	\N	4102	2556	423	3	3.67	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	1-1440-47003-71-5	\N	2	จันทร์เพ็ญ	\N	สุวรรณภูมิ	2	1	0	0	2	ถนนสรงประภา	\N	\N	4104	2556	423	2	3.17	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	2-2865-36731-48-4	\N	1	อภิวัฒน์	\N	วิไลวรรณ	1	1	0	0	5	ถนนโชคชัย	\N	\N	4103	2562	106	1	2.17	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	3-8564-66035-79-7	\N	2	กาญจนา	\N	ดีสมัย	2	1	0	0	2	ถนนศรีนครินทร์	\N	\N	4102	2567	101	3	3.44	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	3-2414-36714-74-2	\N	3	นลินทิพย์	\N	ปัญญาดี	2	1	0	0	4	ถนนลาดพร้าว	\N	\N	4102	2560	112	1	2.3	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	1-9929-94505-77-2	\N	1	ศิวกร	\N	ชูศรี	1	1	0	0	10	ถนนบายพาส	\N	\N	4103	2562	106	1	2.33	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010009	4-9200-85197-16-2	\N	1	สิรภพ	\N	สุขสบาย	1	1	0	0	2	ถ.รัฐพัฒนา	\N	\N	9203	2563	105	3	2.39	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010005	1-9407-30195-18-4	\N	3	สุดารัตน์	\N	เพ็งพา	2	1	0	0	4	ถนนห้วยแก้ว	\N	\N	4102	2559	113	3	2.22	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	7-9012-17056-48-2	\N	2	กัญญา	\N	จันทร์แก้ว	2	1	0	0	8	ถนนบรมราชชนนี	\N	\N	4104	2560	112	1	3.52	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	8-5760-14687-51-1	\N	1	ชัยชนะ	\N	คงมั่น	1	1	0	0	2	ถนนสุรวงศ์	\N	\N	4105	2562	106	1	3.24	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	7-1455-74630-19-5	\N	1	ดิศรณ์	\N	มณีรัตน์	1	1	0	0	9	ถ.เอกชัย	\N	\N	4102	2563	105	2	3.18	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	3-6867-95592-68-3	\N	2	มณีรัตน์	\N	ปัญญาดี	2	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	4104	2567	103	2	3.55	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	1	10010005	2-2520-95501-95-1	\N	2	ประภา	\N	ศรีสุข	2	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	4104	2562	106	1	3.32	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	4-1990-65643-61-8	\N	1	ชินดนัย	\N	งามดี	1	1	0	0	1	ถนนพหลโยธิน	\N	\N	4105	2558	421	2	3.72	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	4	10010005	4-3243-42482-37-8	\N	3	จิตรลดา	\N	ประสิทธิ์ผล	2	1	0	0	1	ถนนสุขุมวิท	\N	\N	4105	2567	103	2	3.44	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	1	10010005	2-5494-95978-16-9	\N	3	ภัทรวดี	\N	พรประเสริฐ	2	1	0	0	7	ถนนอ่อนนุช	\N	\N	4101	2558	421	3	2.99	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	7-6531-80060-72-5	\N	1	ธนาธิป	\N	คงมั่น	1	1	0	0	5	ถนนนวมินทร์	\N	\N	4103	2559	113	1	3.6	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	1-9075-34445-28-9	\N	1	ทักษิณ	\N	อ่อนน้อม	1	1	0	0	6	ถนนนวมินทร์	\N	\N	4102	2567	101	2	3	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	6-2844-37731-89-2	\N	1	ณัฐวรรธน์	\N	เกียรติสกุล	1	1	0	0	10	ถนนมาลัยแมน	\N	\N	4105	2557	422	3	2.55	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	4-9975-74099-35-7	\N	1	นรวิชญ์	\N	ขาวสะอาด	1	1	0	0	10	ถนนอ่อนนุช	\N	\N	4105	2560	112	1	2.86	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	1	10010005	7-5183-67537-56-9	\N	1	ปัณณทัต	\N	บุญรอด	1	1	0	0	5	ถนนมาลัยแมน	\N	\N	4101	2567	103	2	3.45	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	8-2447-27074-14-7	\N	3	อภิญญา	\N	ทั่วถึง	2	1	0	0	4	ถนนเพชรเกษม	\N	\N	4104	2566	102	1	3.09	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	2-5262-56969-75-5	\N	3	เกวลิน	\N	เพ็งพา	2	1	0	0	1	ถนนโชคชัย	\N	\N	4105	2560	112	2	2.8	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	3-9913-24777-49-4	\N	1	รัฐนนท์	\N	ทั่วถึง	1	1	0	0	7	ถนนงามวงศ์วาน	\N	\N	4103	2563	105	1	2.74	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	1-4248-59158-19-2	\N	1	รชานนท์	\N	บุญรอด	1	1	0	0	9	ถนนราษฎร์บูรณะ	\N	\N	4104	2567	101	1	2.96	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	3	10010005	5-7210-55958-43-3	\N	2	วันวิสา	\N	ธนาคาร	2	1	0	0	7	ถนนโชคชัย	\N	\N	4103	2558	421	2	3.42	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	5-1447-36005-47-5	\N	1	วีรชัย	\N	วิริยะ	1	1	0	0	6	ถนนกาญจนาภิเษก	\N	\N	4103	2561	111	2	3.01	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	1-2412-22152-86-7	\N	3	ดรุณี	\N	สุจริต	2	1	0	0	3	ถนนชัยพฤกษ์	\N	\N	4104	2556	423	1	2.02	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	3-2621-95410-66-4	\N	2	นันทพร	\N	พรประเสริฐ	2	1	0	0	7	ถนนเจริญกรุง	\N	\N	4104	2563	105	2	3.81	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	8-1351-86739-34-5	\N	1	ปิยังกูร	\N	เกียรติสกุล	1	1	0	0	1	ถนนบรมราชชนนี	\N	\N	4101	2556	423	2	3.68	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	5-1315-41529-45-9	\N	3	แสงดาว	\N	ทองดี	2	1	0	0	5	ถนนประดิษฐ์มนูธรรม	\N	\N	4105	2557	422	1	2.38	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	1	10010005	3-8979-84765-52-6	\N	3	กุลธิดา	\N	ปัญญาดี	2	1	0	0	2	ถนนนิมมานเหมินท์	\N	\N	4104	2558	421	1	3.38	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	3	10010005	7-6395-48493-27-2	\N	1	ไกรวุฒิ	\N	สุวรรณภูมิ	1	1	0	0	8	ถนนมิตรภาพ	\N	\N	4103	2567	103	3	3.55	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	2-7797-18760-92-8	\N	3	อรณิชา	\N	ชัยมงคล	2	1	0	0	4	ถนนกาญจนาภิเษก	\N	\N	4102	2567	103	1	3.94	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	2-7705-37899-80-4	\N	3	พรรษา	\N	สุดสวย	2	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	4103	2564	104	1	2.62	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	1-8620-82900-23-3	\N	3	สุมาลี	\N	วังขวา	2	1	0	0	10	ถนนวิภาวดีรังสิต	\N	\N	4101	2557	422	1	2.18	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	5-5617-21778-99-5	\N	3	ลลิตา	\N	ใจดี	2	1	0	0	3	ถนนสุรวงศ์	\N	\N	4102	2562	106	2	3.75	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	8-3768-98408-78-8	\N	3	จันทร์เพ็ญ	\N	สง่างาม	2	1	0	0	6	ถนนสุดสาคร	\N	\N	4102	2563	105	1	3.28	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	6-7199-45903-91-8	\N	2	ดรุณี	\N	เพียรดี	2	1	0	0	8	ถนนเพชรเกษม	\N	\N	4102	2567	103	1	2.95	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	2-9596-71439-14-9	\N	1	ชาตรี	\N	พรประเสริฐ	1	1	0	0	10	ถนนกาญจนาภิเษก	\N	\N	4105	2557	422	3	3.46	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	7-2953-19970-48-7	\N	1	วรพล	\N	สุขสบาย	1	1	0	0	5	ถนนเยาวราช	\N	\N	4104	2558	421	1	2.23	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	8-6951-49771-32-5	\N	2	จันทร์เพ็ญ	\N	จันทร์แก้ว	2	1	0	0	8	ถนนสาทร	\N	\N	4105	2566	102	1	2.59	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	4	10010005	8-8511-10620-17-8	\N	2	จันทร์เพ็ญ	\N	พงษ์ไพร	2	1	0	0	9	ถนนประดิษฐ์มนูธรรม	\N	\N	4104	2566	102	2	3.34	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	2-3569-21343-93-9	\N	1	วสันต์	\N	รักษ์ไทย	1	1	0	0	1	ถนนประดิษฐ์มนูธรรม	\N	\N	4103	2566	102	1	3	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	1-7702-97273-61-7	\N	1	ทัศนัย	\N	เพ็งพา	1	1	0	0	1	ถนนชัยพฤกษ์	\N	\N	4104	2558	421	3	3.94	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	8-2035-63722-49-7	\N	2	ทิพย์สุดา	\N	ศักดิ์สิทธิ์	2	1	0	0	9	ถนนสรงประภา	\N	\N	4102	2566	102	3	4	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	8-1157-87821-12-8	\N	1	ชูเกียรติ	\N	วังขวา	1	1	0	0	1	ถนนสุรวงศ์	\N	\N	4101	2557	422	1	3.37	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	7-4683-31524-14-8	\N	2	ปิยนุช	\N	พรประเสริฐ	2	1	0	0	1	ถนนโชคชัย	\N	\N	4105	2558	421	3	3.41	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	7-9056-49907-79-8	\N	1	กันตภณ	\N	วิริยะ	1	1	0	0	7	ถนนศรีนครินทร์	\N	\N	4103	2559	113	1	3.34	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	6-7471-51505-66-3	\N	2	มณีรัตน์	\N	มงคล	2	1	0	0	7	ถ.เอกชัย	\N	\N	4104	2560	112	3	3.73	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	8-5447-75327-71-6	\N	3	ทิพย์สุดา	\N	วงษ์สุวรรณ	2	1	0	0	1	ถนนลาดพร้าว	\N	\N	4105	2556	423	1	3	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	3-7507-90144-38-1	\N	1	พิพัฒน์	\N	ชัยมงคล	1	1	0	0	4	ถนนสรงประภา	\N	\N	4102	2561	111	1	2.53	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	1-1540-70482-43-1	\N	3	รุ่งอรุณ	\N	สุวรรณภูมิ	2	1	0	0	7	ถนนสีลม	\N	\N	4102	2556	423	2	2.45	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	8-7548-72735-57-2	\N	3	กัญญาณัฐ	\N	วิริยะ	2	1	0	0	3	ถนนช้างเผือก	\N	\N	4103	2563	105	3	2.3	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	6-4439-62355-62-4	\N	1	สุรชัย	\N	งามดี	1	1	0	0	4	ถนนสรงประภา	\N	\N	4105	2562	106	1	2.12	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	6-7557-30885-76-4	\N	2	อัมพร	\N	คงมั่น	2	1	0	0	8	ถนนสรงประภา	\N	\N	4103	2563	105	1	3.07	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	4-2671-14632-39-4	\N	1	วุฒิพงษ์	\N	สุจริต	1	1	0	0	8	ถนนรัตนาธิเบศร์	\N	\N	4102	2566	102	2	3.63	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	5-1557-36792-67-1	\N	1	ปิยังกูร	\N	สุดสวย	1	1	0	0	5	ถนนอ่อนนุช	\N	\N	4105	2560	112	1	3.31	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	1	10010005	4-9738-46822-56-7	\N	1	วิชญ์พล	\N	งามดี	1	1	0	0	2	ถนนสรงประภา	\N	\N	4102	2567	101	3	3.44	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	2-9581-94111-90-6	\N	3	นวลจันทร์	\N	ศักดิ์สิทธิ์	2	1	0	0	2	ถ.เอกชัย	\N	\N	4101	2560	112	2	2.44	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	6-6032-49642-98-3	\N	3	ดรุณี	\N	บุญรอด	2	1	0	0	2	ถนนกลางเมือง	\N	\N	4101	2567	101	2	3.05	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	6-4379-29066-90-8	\N	2	รุ่งอรุณ	\N	บริบูรณ์	2	1	0	0	4	ถนนอุดรดุษฎี	\N	\N	4105	2561	111	2	2.72	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	1-4620-89066-68-8	\N	2	เพ็ญพักตร์	\N	หอมหวาน	2	1	0	0	9	ถนนสาทร	\N	\N	4102	2559	113	3	2.43	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	6-7891-55278-56-2	\N	1	ศุภณัฐ	\N	สุดสวย	1	1	0	0	1	ถนนสรงประภา	\N	\N	4103	2567	101	1	2.75	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	1-7607-94702-68-4	\N	3	พิมพ์ชนก	\N	สกุลดี	2	1	0	0	5	ถ.บ้านโป่ง	\N	\N	4104	2559	113	2	3.28	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	4-3331-83336-84-6	\N	2	กาญจนา	\N	ขาวสะอาด	2	1	0	0	10	ถนนบรมราชชนนี	\N	\N	4105	2560	112	3	3.06	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	8-7244-32137-29-2	\N	1	วิชญ์พล	\N	พรประเสริฐ	1	1	0	0	6	ถนนมิตรภาพ	\N	\N	4103	2557	422	2	2.29	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	4-5213-90620-53-5	\N	3	นลินทิพย์	\N	พันธุ์ดี	2	1	0	0	1	ถนนอ่อนนุช	\N	\N	4102	2561	111	3	3.97	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	4-2220-71594-17-9	\N	3	ชนิดา	\N	รุ่งเรือง	2	1	0	0	8	ถนนสาทร	\N	\N	4103	2556	423	3	3.31	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	8-4342-59829-95-7	\N	1	ณัฐพล	\N	รักษ์ไทย	1	1	0	0	4	ถนนราษฎร์บูรณะ	\N	\N	4101	2559	113	3	2.29	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	3-3785-36804-46-9	\N	3	วันวิสา	\N	เพียรดี	2	1	0	0	8	ถนนกาญจนาภิเษก	\N	\N	4104	2567	103	3	3.47	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	2-1546-89063-11-5	\N	1	ไกรวุฒิ	\N	ใจดี	1	1	0	0	9	ถนนเจริญกรุง	\N	\N	4104	2563	105	1	3.59	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	5-5984-68625-81-4	\N	2	จิราพร	\N	ทั่วถึง	2	1	0	0	8	ถนนโชคชัย	\N	\N	4104	2556	423	3	2.31	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	1	10010005	1-1380-88573-35-8	\N	3	เพ็ญพักตร์	\N	ยิ้มแย้ม	2	1	0	0	2	ถนนมาลัยแมน	\N	\N	4103	2561	111	2	3.99	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	8-5045-45638-63-7	\N	3	จันทร์เพ็ญ	\N	ยิ้มแย้ม	2	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	4105	2559	113	1	2.57	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	1-6334-27140-74-1	\N	2	ศิริพร	\N	สุดสวย	2	1	0	0	6	ถนนบายพาส	\N	\N	4102	2558	421	2	3.54	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	5-8362-68004-21-9	\N	2	มณีรัตน์	\N	ศักดิ์สิทธิ์	2	1	0	0	9	ถนนโชคชัย	\N	\N	4102	2561	111	3	3.64	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	7-9324-51800-89-4	\N	1	กวินท์	\N	นามมนตรี	1	1	0	0	9	ถนนลาดพร้าว	\N	\N	4102	2557	422	2	2.09	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	7-5594-61548-87-3	\N	3	รัตนาภรณ์	\N	แสงสว่าง	2	1	0	0	5	ถนนสีลม	\N	\N	4102	2562	106	1	3.02	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	2-4058-23385-97-6	\N	3	พรทิพย์	\N	หอมหวาน	2	1	0	0	7	ถนนลาดพร้าว	\N	\N	4105	2567	103	3	2.79	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	1	10010005	4-6408-50677-63-5	\N	1	ธนพัฒน์	\N	มีสุข	1	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	4101	2563	105	3	3.09	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	8-5525-70234-65-2	\N	1	พิพัฒน์	\N	ชูศรี	1	1	0	0	2	ถนนอุดรดุษฎี	\N	\N	4101	2563	105	2	2.8	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	4-7636-51026-54-9	\N	1	ธนาธิป	\N	สมบูรณ์	1	1	0	0	7	ถนนโชคชัย	\N	\N	4101	2558	421	1	3.97	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	4-4520-38400-57-3	\N	1	วสันต์	\N	ดำรงค์	1	1	0	0	9	ถนนมาลัยแมน	\N	\N	4101	2564	104	2	2.42	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	5	10010005	1-1424-31934-85-6	\N	2	พิมพ์ชนก	\N	ปัญญาดี	2	1	0	0	8	ถนนอ่อนนุช	\N	\N	4102	2560	112	2	2.63	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	8-2551-81038-21-6	\N	1	ชนะชัย	\N	มณีรัตน์	1	1	0	0	9	ถนนรัตนาธิเบศร์	\N	\N	4101	2561	111	2	3.66	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	5	10010005	2-4107-62582-90-6	\N	2	วันวิสา	\N	คงพิทักษ์	2	1	0	0	1	ถนนมิตรภาพ	\N	\N	4103	2567	103	3	3.59	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	8-2335-75754-65-8	\N	2	สุภัสสรา	\N	เพียรดี	2	1	0	0	2	ถ.เอกชัย	\N	\N	4105	2558	421	3	2.82	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	4-3669-83203-56-1	\N	1	ปิยังกูร	\N	สุขสบาย	1	1	0	0	8	ถนนเพชรเกษม	\N	\N	4103	2563	105	1	3.19	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	4-5578-85561-55-3	\N	2	กัญญาณัฐ	\N	ชูศรี	2	1	0	0	3	ถนนลาดพร้าว	\N	\N	4102	2567	103	1	2.33	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	8-9126-57607-76-9	\N	2	ปัณฑิตา	\N	ปัญญาดี	2	1	0	0	6	ถนนบายพาส	\N	\N	4102	2559	113	3	2.15	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	2-2118-33765-63-3	\N	1	สมศักดิ์	\N	มีสุข	1	1	0	0	1	ถนนสีลม	\N	\N	4103	2564	104	1	2.9	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	2-3752-24439-25-9	\N	1	วีรชัย	\N	ชูศรี	1	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	4103	2556	423	2	2.64	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	4-4631-35646-17-3	\N	1	ปิยังกูร	\N	วงษ์สุวรรณ	1	1	0	0	6	ถนนมิตรภาพ	\N	\N	4101	2567	101	3	3.57	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	5-6584-88647-65-9	\N	2	มาลัย	\N	แสงสว่าง	2	1	0	0	9	ถนนเพชรเกษม	\N	\N	4104	2559	113	1	2.23	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	1	10010005	1-5721-57095-13-6	\N	1	มานพ	\N	วังขวา	1	1	0	0	3	ถนนบรมราชชนนี	\N	\N	4104	2567	101	3	3.64	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	2-7634-45924-23-9	\N	1	อภิวัฒน์	\N	งามดี	1	1	0	0	1	ถนนเยาวราช	\N	\N	4101	2567	101	2	2.51	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	5	10010005	8-2674-43640-14-9	\N	3	วันวิสา	\N	สุขสันต์	2	1	0	0	4	ถนนกาญจนาภิเษก	\N	\N	4101	2559	113	3	2.15	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	5	10010005	7-1189-87414-97-6	\N	3	ดรุณี	\N	หอมหวาน	2	1	0	0	9	ถนนลาดพร้าว	\N	\N	4103	2564	104	2	2.25	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	4-9951-55663-83-1	\N	3	อรณิชา	\N	หอมหวาน	2	1	0	0	8	ถนนเยาวราช	\N	\N	4103	2566	102	2	3.39	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	1-5757-91303-55-8	\N	1	ไกรวุฒิ	\N	นามมนตรี	1	1	0	0	8	ถนนอุดรดุษฎี	\N	\N	4101	2559	113	1	3.33	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	5	10010005	7-2402-88717-54-4	\N	1	ณัฐวุฒิ	\N	มงคล	1	1	0	0	1	ถนนเพชรเกษม	\N	\N	4102	2566	102	2	3.18	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	5-7149-77993-50-1	\N	3	วิมลรัตน์	\N	บุญมี	2	1	0	0	3	ถนนบายพาส	\N	\N	4105	2557	422	1	2.94	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	4	10010005	7-7339-27970-79-7	\N	1	ไกรวุฒิ	\N	พรสวรรค์	1	1	0	0	7	ถนนพหลโยธิน	\N	\N	4104	2557	422	1	2.24	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	7-9984-87921-90-7	\N	1	พิพัฒน์	\N	คงพิทักษ์	1	1	0	0	8	ถนนลาดพร้าว	\N	\N	4105	2566	102	2	3.71	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	5-1734-30727-18-6	\N	1	ธัชพล	\N	เกียรติสกุล	1	1	0	0	8	ถนนสรงประภา	\N	\N	4104	2557	422	2	3.49	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	3	10010005	4-6573-29840-53-7	\N	1	ศุภณัฐ	\N	วังขวา	1	1	0	0	1	ถนนพหลโยธิน	\N	\N	4102	2560	112	1	2.55	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	6-1926-54496-29-1	\N	3	วันวิสา	\N	คงพิทักษ์	2	1	0	0	6	ถนนสีลม	\N	\N	4104	2556	423	2	2.36	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	7-1272-53173-88-4	\N	2	กุลธิดา	\N	ดีสมัย	2	1	0	0	5	ถนนชัยพฤกษ์	\N	\N	4101	2564	104	2	2.87	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	3-5437-43835-38-2	\N	1	อภิวัฒน์	\N	บุญมี	1	1	0	0	5	ถนนงามวงศ์วาน	\N	\N	4101	2560	112	3	2.17	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	4-8628-73139-85-9	\N	3	ณัฐนิชา	\N	วิริยะ	2	1	0	0	3	ถนนนิมมานเหมินท์	\N	\N	4102	2558	421	3	3.81	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	3-4736-22154-37-8	\N	1	ทัศนัย	\N	รักษ์ไทย	1	1	0	0	10	ถนนเจริญกรุง	\N	\N	4101	2556	423	2	3.86	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	3-6091-31315-62-6	\N	1	ธนพัฒน์	\N	จันทร์แก้ว	1	1	0	0	8	ถนนเจริญกรุง	\N	\N	4101	2567	101	3	3.35	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	6-3088-64658-37-5	\N	3	สิริมา	\N	เกียรติสกุล	2	1	0	0	9	ถนนเจริญกรุง	\N	\N	4105	2566	102	2	3.96	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	3-3101-93806-51-4	\N	1	ชินดนัย	\N	ทั่วถึง	1	1	0	0	6	ถนนรามคำแหง	\N	\N	4104	2567	103	2	2.76	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	1-5088-42999-53-6	\N	1	เจษฎา	\N	พรประเสริฐ	1	1	0	0	4	ถนนประดิษฐ์มนูธรรม	\N	\N	4105	2559	113	3	2.05	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	1	10010005	8-8129-59766-58-1	\N	1	ธนพัฒน์	\N	ลือชา	1	1	0	0	9	ถนนสรงประภา	\N	\N	4102	2559	113	2	2.88	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	3-1911-92020-70-6	\N	3	สุดารัตน์	\N	วังขวา	2	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	4105	2566	102	1	3.58	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	6-3232-61921-26-2	\N	1	สมศักดิ์	\N	เจริญชัย	1	1	0	0	1	ถ.เอกชัย	\N	\N	4105	2557	422	3	2.38	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	2-1249-60815-20-5	\N	2	จันทร์เพ็ญ	\N	หอมหวาน	2	1	0	0	5	ถนนมิตรภาพ	\N	\N	4103	2562	106	1	3.27	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	8-6109-45549-36-4	\N	1	มานพ	\N	ธนาคาร	1	1	0	0	2	ถ.เอกชัย	\N	\N	4105	2563	105	2	2.71	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	5-8387-31578-89-7	\N	1	รัฐนนท์	\N	สุจริต	1	1	0	0	10	ถ.รัฐพัฒนา	\N	\N	4103	2567	101	1	3.73	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	5-5940-88611-86-8	\N	1	ศุภณัฐ	\N	มณีรัตน์	1	1	0	0	6	ถนนนวมินทร์	\N	\N	4101	2567	103	3	2.74	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	5	10010005	8-9384-62883-16-3	\N	3	กัญญา	\N	ยิ้มแย้ม	2	1	0	0	2	ถนนกลางเมือง	\N	\N	4101	2562	106	3	3.01	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	4-9437-26720-72-5	\N	1	วุฒิพงษ์	\N	คงพิทักษ์	1	1	0	0	10	ถนนลาดพร้าว	\N	\N	4103	2557	422	2	2.87	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	6-5326-82974-15-8	\N	1	นรวิชญ์	\N	ศรีสุข	1	1	0	0	1	ถนนวิภาวดีรังสิต	\N	\N	4102	2563	105	1	2.46	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	5-8533-71813-73-5	\N	2	สิริมา	\N	ขาวสะอาด	2	1	0	0	1	ถ.รัฐพัฒนา	\N	\N	4105	2558	421	2	3.11	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	4	10010005	1-8361-59496-27-3	\N	1	วิชญ์พล	\N	ประสิทธิ์ผล	1	1	0	0	9	ถนนชัยพฤกษ์	\N	\N	4104	2561	111	2	2.92	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	4-9248-64439-78-3	\N	1	ธนาธิป	\N	ธนาคาร	1	1	0	0	8	ถนนประดิษฐ์มนูธรรม	\N	\N	4105	2561	111	1	3.25	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	4-4236-11454-48-6	\N	3	ประภา	\N	บุญมี	2	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	4104	2556	423	3	3.58	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	7-1531-45804-79-6	\N	1	บุญยิ่ง	\N	งามดี	1	1	0	0	4	ถนนเพชรเกษม	\N	\N	4101	2556	423	2	3.32	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	5-2500-24741-76-5	\N	1	ชินดนัย	\N	หอมหวาน	1	1	0	0	7	ถนนมิตรภาพ	\N	\N	4103	2567	101	2	3.28	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	4-8662-83050-97-2	\N	1	อภิวัฒน์	\N	หอมหวาน	1	1	0	0	8	ถนนสุขุมวิท	\N	\N	4102	2559	113	1	3.75	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	2-2362-63840-53-6	\N	2	กัญญา	\N	ธนาคาร	2	1	0	0	6	ถนนประดิษฐ์มนูธรรม	\N	\N	4104	2560	112	3	3.9	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	4-2710-37338-62-4	\N	3	ดรุณี	\N	เพ็งพา	2	1	0	0	7	ถนนช้างเผือก	\N	\N	4101	2567	101	1	3.25	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	8-6998-84443-36-6	\N	3	ธัญชนก	\N	ประสิทธิ์ผล	2	1	0	0	9	ถนนอุดรดุษฎี	\N	\N	4104	2566	102	3	3.24	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	1	10010005	2-6669-38843-81-1	\N	1	นรวิชญ์	\N	สุขสันต์	1	1	0	0	9	ถนนนวมินทร์	\N	\N	4103	2562	106	2	2.51	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	1-9028-63220-24-6	\N	3	ธัญชนก	\N	ธนาคาร	2	1	0	0	1	ถนนลาดพร้าว	\N	\N	4104	2558	421	1	2.4	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	1-6043-47101-33-4	\N	1	วรากร	\N	วงษ์สุวรรณ	1	1	0	0	7	ถนนเยาวราช	\N	\N	4102	2561	111	1	2.8	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	2-1041-78757-60-2	\N	2	เพ็ญพักตร์	\N	งามดี	2	1	0	0	7	ถนนเยาวราช	\N	\N	4101	2558	421	3	3.21	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	5	10010005	8-4672-79509-94-1	\N	2	จันทร์เพ็ญ	\N	ขาวสะอาด	2	1	0	0	7	ถ.รัฐพัฒนา	\N	\N	4105	2562	106	1	2.69	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	7-2936-15905-33-4	\N	2	พรรษา	\N	เจริญชัย	2	1	0	0	8	ถนนศรีนครินทร์	\N	\N	4104	2561	111	1	3.25	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	1	10010005	7-8189-30739-44-6	\N	2	สุดารัตน์	\N	สุจริต	2	1	0	0	10	ถ.เอกชัย	\N	\N	4102	2567	101	2	3.26	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	4-3571-74080-69-1	\N	1	บุญยิ่ง	\N	มงคล	1	1	0	0	2	ถนนรามคำแหง	\N	\N	4103	2567	101	3	3.17	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	3-7778-10603-85-7	\N	2	สุดารัตน์	\N	สุขสันต์	2	1	0	0	9	ถนนช้างเผือก	\N	\N	4104	2557	422	1	3.25	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	1	10010005	8-4284-55451-74-7	\N	3	วาสนา	\N	งามดี	2	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	4101	2563	105	3	2.69	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	1-3756-60158-35-3	\N	1	อนุชา	\N	ดีสมัย	1	1	0	0	8	ถนนสุดสาคร	\N	\N	4104	2564	104	2	3.79	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	5-6485-77927-66-7	\N	3	รุ่งอรุณ	\N	พรสวรรค์	2	1	0	0	7	ถนนเยาวราช	\N	\N	4103	2563	105	2	3.62	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	5-6238-94905-14-3	\N	2	ลลิตา	\N	สุวรรณภูมิ	2	1	0	0	5	ถนนสุขุมวิท	\N	\N	4103	2567	103	2	3.74	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	5-9588-90103-60-6	\N	3	นลินทิพย์	\N	กิตติคุณ	2	1	0	0	4	ถนนเยาวราช	\N	\N	4102	2556	423	3	2.01	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	1-8897-78809-10-6	\N	2	ณัฐนิชา	\N	มีสุข	2	1	0	0	4	ถนนนวมินทร์	\N	\N	4103	2558	421	3	3.73	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	3-2980-42463-62-7	\N	1	ชินดนัย	\N	สีดา	1	1	0	0	5	ถนนเจริญกรุง	\N	\N	4105	2567	103	2	3.24	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	4	10010005	1-5502-21450-55-1	\N	1	อนุชา	\N	นามมนตรี	1	1	0	0	7	ถนนสาทร	\N	\N	4101	2559	113	1	2.92	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	3-7678-57312-76-4	\N	1	สมศักดิ์	\N	หอมหวาน	1	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	4101	2562	106	1	2.09	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	5-7456-66607-14-4	\N	2	สิริมา	\N	พันธุ์ดี	2	1	0	0	4	ถนนสรงประภา	\N	\N	4104	2566	102	2	3.47	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	3	10010005	1-5647-19150-16-2	\N	3	กุลธิดา	\N	หอมหวาน	2	1	0	0	1	ถนนศรีนครินทร์	\N	\N	4101	2558	421	3	2.29	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	6-2883-61346-48-9	\N	2	อัมพร	\N	ลือชา	2	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	4105	2559	113	3	3.75	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	1-7997-21428-43-5	\N	3	ดรุณี	\N	ดีสมัย	2	1	0	0	4	ถนนห้วยแก้ว	\N	\N	4105	2567	103	1	3.75	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	6-1375-55080-95-3	\N	3	นวลจันทร์	\N	นามมนตรี	2	1	0	0	7	ถนนลาดพร้าว	\N	\N	4104	2563	105	3	2.42	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	7-8707-17924-71-2	\N	1	ทัศนัย	\N	บริบูรณ์	1	1	0	0	9	ถนนรามคำแหง	\N	\N	4101	2562	106	3	2.94	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	4	10010005	2-3086-34589-72-8	\N	1	ไกรวุฒิ	\N	สมบูรณ์	1	1	0	0	5	ถนนกลางเมือง	\N	\N	4102	2567	103	1	3.75	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	8-1147-53839-98-9	\N	2	แสงดาว	\N	สุดสวย	2	1	0	0	1	ถ.บ้านโป่ง	\N	\N	4102	2561	111	2	2.94	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	7-5379-15351-73-1	\N	1	ทัศนัย	\N	ทองดี	1	1	0	0	8	ถนนเจริญกรุง	\N	\N	4104	2556	423	1	3.77	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	4-1174-39884-42-9	\N	1	ทัศนัย	\N	บุญรอด	1	1	0	0	6	ถ.รัฐพัฒนา	\N	\N	4103	2564	104	3	3.52	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	3-8851-34209-75-1	\N	1	ภัคพล	\N	ชัยมงคล	1	1	0	0	10	ถนนพหลโยธิน	\N	\N	4103	2561	111	2	3.78	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	7-5199-42204-20-7	\N	1	รัฐนนท์	\N	มีสุข	1	1	0	0	8	ถนนเจริญกรุง	\N	\N	4105	2564	104	1	3.63	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	1	10010005	6-4532-13139-35-3	\N	3	วันวิสา	\N	หอมหวาน	2	1	0	0	1	ถ.รัฐพัฒนา	\N	\N	4103	2567	103	3	3.21	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	1-3034-57396-30-4	\N	2	อัมพร	\N	มงคล	2	1	0	0	1	ถนนสรงประภา	\N	\N	4103	2561	111	2	3.31	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	6-7546-56219-43-1	\N	2	นภาพร	\N	อินทร์ชัย	2	1	0	0	4	ถนนสุขุมวิท	\N	\N	4101	2567	103	1	3.84	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	8-4415-31410-13-2	\N	2	จิตรลดา	\N	พรสวรรค์	2	1	0	0	3	ถนนมิตรภาพ	\N	\N	4103	2564	104	1	3.65	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	4-2284-97071-78-3	\N	1	ศุภณัฐ	\N	ศักดิ์สิทธิ์	1	1	0	0	1	ถนนบายพาส	\N	\N	4103	2566	102	1	2.94	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	4-1916-55428-48-9	\N	1	ณัฐพล	\N	ขาวสะอาด	1	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	4105	2560	112	3	2.07	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	4	10010005	4-9608-29708-44-6	\N	1	คุณากร	\N	สุวรรณภูมิ	1	1	0	0	6	ถนนสุรวงศ์	\N	\N	4104	2567	103	3	3	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	4-9441-28098-65-5	\N	1	ประพันธ์	\N	มงคล	1	1	0	0	3	ถนนมิตรภาพ	\N	\N	4101	2563	105	1	2.97	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	7-9648-78937-94-2	\N	1	ธนพัฒน์	\N	ชัยมงคล	1	1	0	0	6	ถนนช้างเผือก	\N	\N	4102	2559	113	2	3.29	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	6-5969-44314-74-8	\N	1	ปัณณทัต	\N	แสงสว่าง	1	1	0	0	7	ถนนเพชรเกษม	\N	\N	4105	2564	104	3	2.96	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	6-1498-76901-83-3	\N	3	พิมพ์ชนก	\N	วิริยะ	2	1	0	0	5	ถนนวิภาวดีรังสิต	\N	\N	4105	2566	102	3	3.61	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	7-6916-55438-55-4	\N	3	จันทร์เพ็ญ	\N	ทองดี	2	1	0	0	6	ถนนช้างเผือก	\N	\N	4102	2567	103	1	3	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	6-5915-68592-67-8	\N	1	ณัฐพล	\N	วิริยะ	1	1	0	0	8	ถนนกาญจนาภิเษก	\N	\N	4102	2567	103	2	2.99	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	8-3431-47808-85-4	\N	2	ดรุณี	\N	เกียรติสกุล	2	1	0	0	8	ถ.เอกชัย	\N	\N	4103	2564	104	1	2.59	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	5-9968-50703-82-7	\N	1	ภูมิพัฒน์	\N	กิตติคุณ	1	1	0	0	8	ถนนเยาวราช	\N	\N	4101	2560	112	2	3.79	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	7-9004-25389-29-6	\N	1	ภัคพล	\N	สกุลดี	1	1	0	0	6	ถนนสีลม	\N	\N	4102	2567	101	3	3.35	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	1-7153-49469-25-3	\N	2	ณัฐนิชา	\N	สง่างาม	2	1	0	0	3	ถ.บ้านโป่ง	\N	\N	4104	2564	104	2	2.67	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	3	10010005	5-7026-24834-98-4	\N	1	ณัฐวรรธน์	\N	ลือชา	1	1	0	0	5	ถนนเพชรเกษม	\N	\N	4104	2564	104	1	3.65	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	3	10010005	4-5747-56293-55-6	\N	2	สมหญิง	\N	แสงสว่าง	2	1	0	0	6	ถนนอุดรดุษฎี	\N	\N	4103	2562	106	2	2.67	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	8-7793-64363-75-1	\N	1	รัฐนนท์	\N	สกุลดี	1	1	0	0	9	ถนนมิตรภาพ	\N	\N	4105	2563	105	1	2.75	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	1	10010005	1-5812-36335-20-8	\N	1	พิพัฒน์	\N	พรสวรรค์	1	1	0	0	2	ถนนกลางเมือง	\N	\N	4105	2562	106	1	3.01	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010005	8-4793-39237-60-9	\N	3	แสงดาว	\N	ศักดิ์สิทธิ์	2	1	0	0	7	ถนนลาดพร้าว	\N	\N	4103	2567	103	1	3.33	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	6-1400-21533-14-6	\N	1	วรากร	\N	เพียรดี	1	1	0	0	6	ถนนประดิษฐ์มนูธรรม	\N	\N	4104	2561	111	3	3.24	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	1	10010005	3-1716-31202-61-5	\N	1	ไกรวุฒิ	\N	วงษ์สุวรรณ	1	1	0	0	1	ถนนลาดพร้าว	\N	\N	4101	2567	101	2	3.76	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	8-1697-34240-10-4	\N	1	ณัฐวรรธน์	\N	สุจริต	1	1	0	0	9	ถนนประดิษฐ์มนูธรรม	\N	\N	4102	2557	422	3	2.87	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	5-5642-68955-76-2	\N	2	ปิยนุช	\N	อ่อนน้อม	2	1	0	0	7	ถ.ประชาสามัคคี	\N	\N	4101	2564	104	3	3.31	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	4-5898-77174-99-2	\N	2	จิราพร	\N	ทั่วถึง	2	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	4103	2564	104	3	2.21	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	3-7767-50233-45-1	\N	1	เอกพงษ์	\N	สง่างาม	1	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	4104	2561	111	2	3.07	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	7-4925-67978-86-6	\N	1	ชูเกียรติ	\N	สุจริต	1	1	0	0	9	ถนนบรมราชชนนี	\N	\N	4102	2566	102	3	3.73	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	8-2446-50102-42-7	\N	3	ลลิตา	\N	นามมนตรี	2	1	0	0	10	ถนนสาทร	\N	\N	4105	2559	113	1	2.62	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	3-4211-90615-45-1	\N	2	นลินทิพย์	\N	พรสวรรค์	2	1	0	0	3	ถนนบายพาส	\N	\N	4103	2559	113	2	2.81	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	7-9509-18372-25-9	\N	1	นพรัตน์	\N	ดำรงค์	1	1	0	0	3	ถนนสรงประภา	\N	\N	4104	2563	105	3	2.78	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	3	10010005	3-4043-16875-38-8	\N	1	ปัณณทัต	\N	เพียรดี	1	1	0	0	4	ถนนสีลม	\N	\N	4102	2558	421	2	3.12	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	1	10010005	8-5928-78265-51-8	\N	3	จันทร์เพ็ญ	\N	แสงสว่าง	2	1	0	0	9	ถนนสุรวงศ์	\N	\N	4104	2560	112	1	3.03	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	3	10010005	6-8362-96847-61-6	\N	1	สิรภพ	\N	ธนาคาร	1	1	0	0	8	ถนนโชคชัย	\N	\N	4103	2566	102	3	3.08	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	3-7481-93519-71-7	\N	2	กัญญา	\N	แสงสว่าง	2	1	0	0	5	ถนนเยาวราช	\N	\N	4103	2562	106	1	3.7	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	2-5183-66936-55-4	\N	3	สิริมา	\N	อินทร์ชัย	2	1	0	0	5	ถนนเยาวราช	\N	\N	4102	2567	101	1	3.05	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	7-8259-42775-68-2	\N	1	กิตติภณ	\N	แสงสว่าง	1	1	0	0	6	ถนนสรงประภา	\N	\N	4103	2556	423	1	3.96	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	6-1355-54607-62-6	\N	1	ปัณณทัต	\N	วิไลวรรณ	1	1	0	0	2	ถนนสุรวงศ์	\N	\N	4101	2564	104	1	3.23	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	3	10010005	5-4072-34330-33-9	\N	1	ณัฐวุฒิ	\N	มงคล	1	1	0	0	8	ถนนอุดรดุษฎี	\N	\N	4105	2557	422	1	3.09	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	5-3111-37159-36-9	\N	2	จันทร์เพ็ญ	\N	สมบูรณ์	2	1	0	0	2	ถนนพหลโยธิน	\N	\N	4104	2557	422	3	3.43	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	1	10010005	3-2335-79303-44-6	\N	2	ปัณฑิตา	\N	ทั่วถึง	2	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	4104	2566	102	1	3.05	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	4	10010005	6-8032-22541-24-5	\N	2	ทิพย์สุดา	\N	ชัยมงคล	2	1	0	0	4	ถนนห้วยแก้ว	\N	\N	4102	2567	103	1	3.47	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	6-3023-38944-15-7	\N	1	กิตติภณ	\N	ขาวสะอาด	1	1	0	0	2	ถนนพหลโยธิน	\N	\N	4101	2561	111	2	3.52	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	5	10010005	6-4295-70280-24-5	\N	1	ปรเมศวร์	\N	จันทร์แก้ว	1	1	0	0	8	ถนนสุรวงศ์	\N	\N	4104	2559	113	3	2.91	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	1	10010005	5-5078-21401-32-7	\N	1	กิตติภณ	\N	พันธุ์ดี	1	1	0	0	7	ถนนมาลัยแมน	\N	\N	4102	2556	423	3	2.25	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	7-6829-54532-75-1	\N	2	จิราพร	\N	สมบูรณ์	2	1	0	0	7	ถนนชัยพฤกษ์	\N	\N	4102	2564	104	2	2.36	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	2	10010005	3-1887-98401-40-7	\N	3	พรรษา	\N	ชัยมงคล	2	1	0	0	8	ถนนรัตนาธิเบศร์	\N	\N	4103	2562	106	2	2.91	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	6-8153-82071-72-1	\N	1	เจษฎา	\N	สีดา	1	1	0	0	7	ถนนพหลโยธิน	\N	\N	4103	2567	103	1	2.21	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	2-7276-69459-98-4	\N	2	พรรษา	\N	สง่างาม	2	1	0	0	3	ถนนสุรวงศ์	\N	\N	4101	2563	105	1	3.4	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	1	10010005	5-9679-46946-84-6	\N	2	กุลธิดา	\N	งามดี	2	1	0	0	2	ถนนมาลัยแมน	\N	\N	4102	2564	104	3	3.76	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	3	10010005	2-9650-39779-14-3	\N	2	กาญจนา	\N	มีสุข	2	1	0	0	5	ถนนศรีนครินทร์	\N	\N	4105	2556	423	1	2.29	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	6-2808-85174-13-3	\N	3	แสงดาว	\N	รุ่งเรือง	2	1	0	0	1	ถนนนิมมานเหมินท์	\N	\N	4105	2560	112	3	3.86	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	1-6178-22914-16-4	\N	1	ชูเกียรติ	\N	อ่อนน้อม	1	1	0	0	4	ถนนวิภาวดีรังสิต	\N	\N	4101	2567	101	3	2.96	10	อุดรธานี	เมืองอุดรธานี	หมากแข้ง
2569	1	2	10010005	8-7034-49669-34-8	\N	2	ทิพย์สุดา	\N	อินทร์ชัย	2	1	0	0	1	ถนนพหลโยธิน	\N	\N	4104	2562	106	1	2.01	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	2	10010005	1-3403-22568-69-1	\N	3	สุภัสสรา	\N	สง่างาม	2	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	4103	2557	422	2	3.86	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	3	10010005	3-4669-37809-90-8	\N	1	รัฐนนท์	\N	ปัญญาดี	1	1	0	0	2	ถ.ประชาสามัคคี	\N	\N	4102	2556	423	3	3.4	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	5	10010005	6-2546-74694-40-4	\N	2	นภาพร	\N	บริบูรณ์	2	1	0	0	1	ถนนงามวงศ์วาน	\N	\N	4104	2563	105	2	2.75	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	5	10010005	4-5052-95257-19-8	\N	1	ณัฐวรรธน์	\N	สุวรรณภูมิ	1	1	0	0	10	ถนนสาทร	\N	\N	4103	2564	104	1	3.59	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	5	10010005	5-1707-60555-54-5	\N	3	วิมลรัตน์	\N	มณีรัตน์	2	1	0	0	6	ถนนชัยพฤกษ์	\N	\N	4105	2564	104	3	3.67	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	4	10010005	7-7040-10879-83-5	\N	2	ดรุณี	\N	สุขสันต์	2	1	0	0	7	ถนนศรีนครินทร์	\N	\N	4103	2566	102	1	3.5	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	4	10010005	3-8375-24504-84-3	\N	1	สุรชัย	\N	บุญรอด	1	1	0	0	7	ถนนสุขุมวิท	\N	\N	4103	2563	105	1	3.31	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	1	10010005	1-2925-13458-87-4	\N	1	วสันต์	\N	เพียรดี	1	1	0	0	7	ถนนพหลโยธิน	\N	\N	4104	2557	422	1	3.12	10	อุดรธานี	เมืองอุดรธานี	บ้านจั่น
2569	1	1	10010005	8-1802-16421-35-3	\N	1	มานพ	\N	นามมนตรี	1	1	0	0	8	ถนนสุดสาคร	\N	\N	4105	2561	111	3	2.32	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	5	10010005	8-9122-16521-20-5	\N	1	คุณากร	\N	มณีรัตน์	1	1	0	0	10	ถ.รัฐพัฒนา	\N	\N	4103	2567	103	2	3.04	10	อุดรธานี	เมืองอุดรธานี	บ้านขาว
2569	1	2	10010005	6-7992-94866-93-7	\N	1	อนุชา	\N	เจริญชัย	1	1	0	0	5	ถนนอุดรดุษฎี	\N	\N	4105	2566	102	1	2.66	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	3	10010005	2-3740-29568-14-6	\N	1	วุฒิพงษ์	\N	มีสุข	1	1	0	0	2	ถนนสาทร	\N	\N	4102	2558	421	3	2.72	10	อุดรธานี	เมืองอุดรธานี	นิคมสงเคราะห์
2569	1	4	10010005	3-6762-15883-16-8	\N	2	จิราพร	\N	มงคล	2	1	0	0	6	ถนนเพชรเกษม	\N	\N	4105	2563	105	2	3.46	10	อุดรธานี	เมืองอุดรธานี	หนองบัว
2569	1	2	10010006	7-9742-32390-40-5	\N	1	ณัฐพล	\N	พรประเสริฐ	1	1	0	0	3	ถนนนวมินทร์	\N	\N	3003	2562	106	1	2.2	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	5-7464-32826-60-8	\N	2	จันทร์เพ็ญ	\N	สีดา	2	1	0	0	2	ถนนสุรวงศ์	\N	\N	3002	2567	101	3	3.82	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	2	10010006	7-8225-15158-67-8	\N	1	ธนภัทร	\N	บุญมี	1	1	0	0	7	ถนนสุขุมวิท	\N	\N	3003	2556	423	2	2.32	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	7-7473-71573-48-1	\N	2	อรณิชา	\N	อ่อนน้อม	2	1	0	0	9	ถ.บ้านโป่ง	\N	\N	3005	2562	106	2	3.28	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	1-1335-41601-37-1	\N	2	อรณิชา	\N	ทองดี	2	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	3004	2559	113	1	3.59	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	8-3253-55175-45-3	\N	1	อนุชา	\N	สุจริต	1	1	0	0	7	ถนนมิตรภาพ	\N	\N	3005	2564	104	1	2.71	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	3-8952-66937-39-9	\N	3	ชลธิชา	\N	ทั่วถึง	2	1	0	0	6	ถนนศรีนครินทร์	\N	\N	3005	2558	421	3	2.41	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	4-7247-94948-34-3	\N	1	นพรัตน์	\N	เพียรดี	1	1	0	0	8	ถนนประดิษฐ์มนูธรรม	\N	\N	3001	2563	105	1	3.59	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	4-6771-69848-93-4	\N	2	ปิยนุช	\N	ลือชา	2	1	0	0	2	ถนนเจริญกรุง	\N	\N	3001	2562	106	1	3.3	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	3-2325-95301-34-6	\N	2	มาลัย	\N	ใจดี	2	1	0	0	4	ถนนนิมมานเหมินท์	\N	\N	3001	2563	105	3	3.16	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	8-7143-10803-81-9	\N	2	สุมาลี	\N	สุวรรณภูมิ	2	1	0	0	5	ถนนวิภาวดีรังสิต	\N	\N	3001	2557	422	3	2.01	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	5	10010006	7-3052-19265-40-9	\N	3	กุลธิดา	\N	บริบูรณ์	2	1	0	0	1	ถนนห้วยแก้ว	\N	\N	3004	2562	106	2	3.41	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	3-7074-86375-52-6	\N	3	ชลธิชา	\N	ศักดิ์สิทธิ์	2	1	0	0	2	ถนนอ่อนนุช	\N	\N	3003	2567	101	2	3.62	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	2-7774-37285-94-6	\N	1	สมศักดิ์	\N	ทองดี	1	1	0	0	2	ถนนเพชรเกษม	\N	\N	3003	2556	423	1	2.7	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	3	10010006	4-8026-40065-61-6	\N	1	ไกรวุฒิ	\N	รุ่งเรือง	1	1	0	0	10	ถนนพหลโยธิน	\N	\N	3004	2563	105	2	2.21	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	3-3304-41097-43-3	\N	2	สุมาลี	\N	หอมหวาน	2	1	0	0	7	ถ.บ้านโป่ง	\N	\N	3001	2558	421	1	2.99	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	2-3292-77627-20-8	\N	2	ปัณฑิตา	\N	ปัญญาดี	2	1	0	0	2	ถนนเจริญกรุง	\N	\N	3002	2560	112	3	3.65	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	2-2156-31132-66-6	\N	1	สมชาย	\N	ขาวสะอาด	1	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	3004	2563	105	1	3.91	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	4-4909-23782-12-9	\N	1	ทัศนัย	\N	มงคล	1	1	0	0	9	ถนนสุดสาคร	\N	\N	3004	2563	105	1	2.18	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	1-1438-40785-78-2	\N	1	ปัณณทัต	\N	แสงสว่าง	1	1	0	0	9	ถนนสุขุมวิท	\N	\N	3004	2558	421	3	3.78	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	1-1729-26906-18-9	\N	1	สมศักดิ์	\N	รุ่งเรือง	1	1	0	0	3	ถนนนิมมานเหมินท์	\N	\N	3003	2563	105	2	3.43	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	3-9483-44313-64-2	\N	1	สมศักดิ์	\N	หอมหวาน	1	1	0	0	7	ถนนประดิษฐ์มนูธรรม	\N	\N	3001	2560	112	1	2.9	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	8-1176-37475-95-3	\N	3	บุษยา	\N	อ่อนน้อม	2	1	0	0	1	ถนนกาญจนาภิเษก	\N	\N	3002	2560	112	1	2.56	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	5-6004-27001-23-1	\N	1	ชัยชนะ	\N	ขาวสะอาด	1	1	0	0	7	ถนนกลางเมือง	\N	\N	3004	2559	113	1	3.45	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	1-5788-24486-35-2	\N	1	กิตติภณ	\N	พรสวรรค์	1	1	0	0	4	ถนนช้างเผือก	\N	\N	3001	2561	111	2	2.2	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	3-3095-98999-39-6	\N	3	เกวลิน	\N	ดำรงค์	2	1	0	0	7	ถ.รัฐพัฒนา	\N	\N	3003	2556	423	1	3.44	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	8-8437-74370-64-8	\N	1	บุญยิ่ง	\N	วงษ์สุวรรณ	1	1	0	0	8	ถนนกลางเมือง	\N	\N	3004	2562	106	1	3.42	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	4-9798-21013-78-4	\N	1	นรวิชญ์	\N	วิริยะ	1	1	0	0	10	ถ.รัฐพัฒนา	\N	\N	3004	2557	422	3	2.15	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	6-2915-86929-42-6	\N	1	กิตติภณ	\N	นามมนตรี	1	1	0	0	6	ถนนโชคชัย	\N	\N	3005	2559	113	1	2.08	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	1-9169-85856-94-7	\N	2	วาสนา	\N	อ่อนน้อม	2	1	0	0	5	ถนนลาดพร้าว	\N	\N	3004	2559	113	2	2.23	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	6-4157-84544-23-9	\N	1	วสันต์	\N	ยิ้มแย้ม	1	1	0	0	6	ถนนสุรวงศ์	\N	\N	3001	2556	423	2	3.61	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	4-3993-68727-20-6	\N	2	สุมาลี	\N	ทองดี	2	1	0	0	5	ถนนสุขุมวิท	\N	\N	3003	2567	101	2	3.4	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	1-8671-93215-19-6	\N	3	พรทิพย์	\N	มงคล	2	1	0	0	4	ถ.รัฐพัฒนา	\N	\N	3004	2561	111	1	2.45	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	6-4588-98312-50-5	\N	2	ธัญชนก	\N	สุจริต	2	1	0	0	5	ถนนลาดพร้าว	\N	\N	3003	2559	113	3	3.3	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	3-3218-23874-14-1	\N	3	ประภา	\N	บริบูรณ์	2	1	0	0	8	ถนนสรงประภา	\N	\N	3004	2562	106	3	3.08	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	2-3044-32778-47-7	\N	1	กันตภณ	\N	มณีรัตน์	1	1	0	0	2	ถ.ประชาสามัคคี	\N	\N	3005	2566	102	2	3.64	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	1-6089-82345-64-7	\N	3	รุ่งอรุณ	\N	บุญรอด	2	1	0	0	8	ถนนบรมราชชนนี	\N	\N	3001	2558	421	1	3.89	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	8-1971-43916-82-9	\N	3	ปาณิสรา	\N	รักษ์ไทย	2	1	0	0	7	ถ.เอกชัย	\N	\N	3004	2560	112	2	2.6	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	1-4783-41744-30-6	\N	1	รัฐนนท์	\N	พรสวรรค์	1	1	0	0	8	ถนนรัตนาธิเบศร์	\N	\N	3001	2559	113	3	2.93	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	7-7932-79482-82-8	\N	3	รุ่งอรุณ	\N	อินทร์ชัย	2	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	3001	2560	112	1	2.27	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	2-8602-67974-89-9	\N	1	วสันต์	\N	สง่างาม	1	1	0	0	10	ถนนชัยพฤกษ์	\N	\N	3001	2567	101	1	3.27	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	2-2724-99140-34-1	\N	2	จิราพร	\N	พันธุ์ดี	2	1	0	0	2	ถนนโชคชัย	\N	\N	3004	2563	105	2	3.71	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	7-7088-22700-75-2	\N	2	วิมลรัตน์	\N	บุญมี	2	1	0	0	3	ถ.รัฐพัฒนา	\N	\N	3002	2562	106	2	3.84	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	1	10010006	4-8541-45495-35-3	\N	2	จิตรลดา	\N	ปัญญาดี	2	1	0	0	6	ถนนบายพาส	\N	\N	3004	2560	112	1	2.49	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	2-3536-36935-25-2	\N	2	วิมลรัตน์	\N	ปัญญาดี	2	1	0	0	6	ถนนเยาวราช	\N	\N	3003	2559	113	2	2.28	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	1-7212-11517-72-2	\N	1	วสันต์	\N	ใจดี	1	1	0	0	4	ถนนสุดสาคร	\N	\N	3001	2557	422	1	3.28	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	5-5338-31489-92-7	\N	1	ณัฐพล	\N	ธนาคาร	1	1	0	0	8	ถนนสุรวงศ์	\N	\N	3001	2558	421	1	2.35	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	7-2780-99839-50-5	\N	3	กุลธิดา	\N	เพียรดี	2	1	0	0	5	ถนนชัยพฤกษ์	\N	\N	3002	2566	102	2	2.68	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	6-9770-30214-61-9	\N	2	ดวงใจ	\N	บุญรอด	2	1	0	0	3	ถนนกลางเมือง	\N	\N	3003	2556	423	2	2.42	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	5-1514-33982-34-3	\N	1	ปิยังกูร	\N	จันทร์แก้ว	1	1	0	0	4	ถนนมิตรภาพ	\N	\N	3003	2563	105	3	3.63	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	6-3808-76582-76-1	\N	2	มาลัย	\N	ปัญญาดี	2	1	0	0	6	ถนนสุขุมวิท	\N	\N	3003	2564	104	1	3.45	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	1	10010006	8-4470-57279-43-5	\N	2	ชนิดา	\N	กิตติคุณ	2	1	0	0	3	ถนนมิตรภาพ	\N	\N	3005	2561	111	3	3.44	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	4	10010006	5-5480-84120-59-5	\N	1	กันตภณ	\N	วังขวา	1	1	0	0	10	ถนนสุรวงศ์	\N	\N	3004	2567	101	2	3.22	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	7-9717-76982-27-7	\N	1	พิพัฒน์	\N	สกุลดี	1	1	0	0	5	ถนนนวมินทร์	\N	\N	3003	2567	101	1	3.15	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	4-6761-95404-47-7	\N	3	อรณิชา	\N	เกียรติสกุล	2	1	0	0	1	ถนนเพชรเกษม	\N	\N	3003	2563	105	2	2.93	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	1	10010006	6-5149-56429-35-7	\N	1	รัฐนนท์	\N	มณีรัตน์	1	1	0	0	1	ถนนบรมราชชนนี	\N	\N	3003	2556	423	2	2.31	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	3-7506-27835-56-2	\N	2	วรรณภา	\N	รักษ์ไทย	2	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	3003	2562	106	1	2.88	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	1	10010006	1-4786-99181-98-5	\N	1	รัฐนนท์	\N	สุจริต	1	1	0	0	4	ถนนโชคชัย	\N	\N	3004	2561	111	1	2.44	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	4-8002-21902-73-5	\N	2	อภิญญา	\N	บริบูรณ์	2	1	0	0	10	ถนนมาลัยแมน	\N	\N	3005	2560	112	2	2.31	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	2-3839-68802-34-2	\N	3	เกวลิน	\N	คงพิทักษ์	2	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	3003	2557	422	2	3.69	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	3-5585-13102-30-4	\N	1	กวินท์	\N	สีดา	1	1	0	0	10	ถนนสาทร	\N	\N	3001	2559	113	1	2.27	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	5-1498-97335-45-1	\N	2	รุ่งอรุณ	\N	ลือชา	2	1	0	0	5	ถนนบายพาส	\N	\N	3004	2559	113	2	2.82	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	2-3011-12085-54-1	\N	3	รุ่งอรุณ	\N	จันทร์แก้ว	2	1	0	0	3	ถนนสรงประภา	\N	\N	3001	2567	103	3	2.88	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	3-8247-65050-72-8	\N	1	กิตติภณ	\N	ลือชา	1	1	0	0	5	ถนนศรีนครินทร์	\N	\N	3003	2564	104	3	2.84	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	3	10010006	4-8484-35365-27-8	\N	1	ทักษิณ	\N	คงมั่น	1	1	0	0	9	ถนนสาทร	\N	\N	3003	2558	421	1	3.82	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	1	10010006	7-1023-74188-66-3	\N	2	วันวิสา	\N	วงษ์สุวรรณ	2	1	0	0	2	ถนนเยาวราช	\N	\N	3003	2559	113	1	2.02	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	7-6624-38387-73-2	\N	1	วสันต์	\N	ยิ้มแย้ม	1	1	0	0	6	ถนนมิตรภาพ	\N	\N	3003	2567	101	2	3.93	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	4-2073-82890-68-4	\N	2	นลินทิพย์	\N	มณีรัตน์	2	1	0	0	1	ถนนกลางเมือง	\N	\N	3003	2556	423	1	3.12	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	4-2727-27062-88-8	\N	1	สุรชัย	\N	นิ่มนวล	1	1	0	0	4	ถนนกาญจนาภิเษก	\N	\N	3002	2557	422	2	2.9	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	3-8436-97797-57-1	\N	1	เอกพงษ์	\N	ขาวสะอาด	1	1	0	0	9	ถนนชัยพฤกษ์	\N	\N	3005	2556	423	1	3.79	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	7-3981-38462-34-6	\N	3	ดวงใจ	\N	สมบูรณ์	2	1	0	0	8	ถนนลาดพร้าว	\N	\N	3004	2558	421	2	2.34	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	1-8824-21192-30-2	\N	2	บุษยา	\N	สุขสบาย	2	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	3005	2562	106	2	2.3	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	3-4843-37486-19-6	\N	2	ธัญชนก	\N	คงพิทักษ์	2	1	0	0	10	ถนนเจริญกรุง	\N	\N	3003	2564	104	2	3.59	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	1	10010009	3-8240-11142-88-4	\N	2	สมหญิง	\N	ใจดี	2	1	0	0	1	ถนนมาลัยแมน	\N	\N	9201	2557	422	2	2.27	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010006	3-4221-11803-80-9	\N	2	มณีรัตน์	\N	บริบูรณ์	2	1	0	0	9	ถนนรัตนาธิเบศร์	\N	\N	3003	2558	421	3	2.06	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	3	10010006	5-2994-38971-13-1	\N	3	พิมพ์ชนก	\N	ใจดี	2	1	0	0	8	ถนนโชคชัย	\N	\N	3004	2567	101	1	2.75	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	6-1080-87031-53-2	\N	3	ศิริพร	\N	พรประเสริฐ	2	1	0	0	5	ถนนช้างเผือก	\N	\N	3004	2558	421	2	3.37	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	5-7444-26768-67-3	\N	1	ศิวกร	\N	นิ่มนวล	1	1	0	0	9	ถนนอุดรดุษฎี	\N	\N	3004	2560	112	1	2.78	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	4-5430-96786-51-1	\N	2	ภัทรวดี	\N	พันธุ์ดี	2	1	0	0	5	ถนนสุดสาคร	\N	\N	3002	2562	106	2	3.59	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	5-4296-85234-46-2	\N	1	ชนะชัย	\N	กิตติคุณ	1	1	0	0	7	ถนนบายพาส	\N	\N	3004	2564	104	3	2.55	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	7-9368-57173-78-6	\N	2	ปาณิสรา	\N	มีสุข	2	1	0	0	8	ถนนกาญจนาภิเษก	\N	\N	3005	2567	103	3	3.78	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	4	10010006	7-8499-94031-29-7	\N	1	ทัศนัย	\N	วงษ์สุวรรณ	1	1	0	0	5	ถนนบรมราชชนนี	\N	\N	3001	2560	112	3	3.62	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	6-4549-69574-70-1	\N	2	เพ็ญพักตร์	\N	อ่อนน้อม	2	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	3005	2563	105	3	3.22	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	4	10010006	3-5238-42354-66-9	\N	2	ดรุณี	\N	สุขสันต์	2	1	0	0	1	ถนนกาญจนาภิเษก	\N	\N	3001	2560	112	3	2.53	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	5	10010006	2-9338-68596-57-7	\N	3	พิมพ์ชนก	\N	ทองดี	2	1	0	0	10	ถนนศรีนครินทร์	\N	\N	3004	2558	421	1	2.78	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	3-8694-37307-53-8	\N	2	ดวงใจ	\N	งามดี	2	1	0	0	2	ถนนชัยพฤกษ์	\N	\N	3001	2556	423	3	3.94	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	6-8501-96472-74-6	\N	3	นภาพร	\N	สมบูรณ์	2	1	0	0	10	ถนนรามคำแหง	\N	\N	3001	2561	111	1	2.21	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	7-1323-10905-84-9	\N	2	พรทิพย์	\N	วังขวา	2	1	0	0	1	ถนนช้างเผือก	\N	\N	3003	2566	102	2	3.66	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	1	10010006	1-4312-45214-19-4	\N	2	บุษยา	\N	รุ่งเรือง	2	1	0	0	7	ถนนช้างเผือก	\N	\N	3005	2566	102	3	3.93	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	5-8271-67827-13-8	\N	1	ปรเมศวร์	\N	ชูศรี	1	1	0	0	1	ถนนอุดรดุษฎี	\N	\N	3005	2557	422	2	3.46	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	4	10010006	4-5055-68345-14-1	\N	1	ภูมิพัฒน์	\N	กิตติคุณ	1	1	0	0	5	ถนนบรมราชชนนี	\N	\N	3003	2561	111	1	3.7	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	7-4905-76025-99-8	\N	3	สุดารัตน์	\N	ดีสมัย	2	1	0	0	7	ถนนศรีนครินทร์	\N	\N	3004	2556	423	2	2.16	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	5-7138-75744-65-7	\N	1	สมชาย	\N	ลือชา	1	1	0	0	2	ถนนเจริญกรุง	\N	\N	3004	2560	112	1	3.48	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	3-9012-76309-56-4	\N	1	ศิวกร	\N	งามดี	1	1	0	0	2	ถนนเยาวราช	\N	\N	3005	2558	421	2	2.13	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	7-4395-43847-97-3	\N	1	วรพล	\N	สีดา	1	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	3005	2561	111	3	3.05	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	3-3009-51162-82-1	\N	1	นรวิชญ์	\N	วังขวา	1	1	0	0	1	ถ.รัฐพัฒนา	\N	\N	3002	2567	103	3	3.7	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	5-6752-65038-68-8	\N	1	นรวิชญ์	\N	บุญมี	1	1	0	0	2	ถนนกลางเมือง	\N	\N	3001	2564	104	3	2.69	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	7-9979-87214-39-2	\N	3	สุภัสสรา	\N	อ่อนน้อม	2	1	0	0	2	ถนนสุดสาคร	\N	\N	3004	2560	112	1	2.59	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	7-7102-72106-65-7	\N	3	ทิพย์สุดา	\N	อ่อนน้อม	2	1	0	0	7	ถนนเยาวราช	\N	\N	3004	2567	103	3	3.9	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	6-3288-86823-65-5	\N	2	จิราพร	\N	ศักดิ์สิทธิ์	2	1	0	0	6	ถนนห้วยแก้ว	\N	\N	3003	2563	105	1	3	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	1	10010006	8-9670-27610-85-9	\N	1	วรากร	\N	กิตติคุณ	1	1	0	0	9	ถ.บ้านโป่ง	\N	\N	3003	2560	112	2	3.15	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	3	10010006	7-2261-82615-56-1	\N	1	เจษฎา	\N	เกียรติสกุล	1	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	3003	2557	422	1	2.33	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	1-7224-72777-27-5	\N	2	แสงดาว	\N	อ่อนน้อม	2	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	3005	2561	111	3	2.7	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	1-4178-21660-79-4	\N	1	มานพ	\N	ทองดี	1	1	0	0	10	ถนนสุรวงศ์	\N	\N	3002	2563	105	1	2.51	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	1	10010006	1-7561-56352-42-9	\N	1	ภูมิพัฒน์	\N	วงษ์สุวรรณ	1	1	0	0	9	ถนนห้วยแก้ว	\N	\N	3001	2567	101	3	2.89	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	3-7433-23676-53-2	\N	3	ปิยนุช	\N	วิไลวรรณ	2	1	0	0	5	ถนนอ่อนนุช	\N	\N	3003	2558	421	3	2.58	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	4-6199-19549-67-9	\N	3	จิตรลดา	\N	หอมหวาน	2	1	0	0	4	ถนนโชคชัย	\N	\N	3003	2566	102	3	3.93	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	3	10010006	7-8078-42432-94-4	\N	2	จันทร์เพ็ญ	\N	เพียรดี	2	1	0	0	9	ถนนมิตรภาพ	\N	\N	3002	2567	103	2	3.94	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	5	10010006	7-1752-26078-86-2	\N	3	รุ่งอรุณ	\N	ใจดี	2	1	0	0	7	ถนนสรงประภา	\N	\N	3004	2566	102	1	2.99	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	4-7444-99653-78-5	\N	3	อัมพร	\N	ยิ้มแย้ม	2	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	3004	2557	422	3	3.9	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	1-2482-10514-26-8	\N	3	สุภัสสรา	\N	ชูศรี	2	1	0	0	2	ถนนรัตนาธิเบศร์	\N	\N	3004	2561	111	2	3.07	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	8-3602-23219-26-2	\N	2	สุมาลี	\N	สุขสันต์	2	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	3001	2559	113	3	3.91	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	5-7833-33969-29-1	\N	1	วสันต์	\N	นามมนตรี	1	1	0	0	2	ถนนสุดสาคร	\N	\N	3003	2567	103	1	3.69	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	6-1597-78409-29-5	\N	3	อัมพร	\N	คงมั่น	2	1	0	0	4	ถนนสรงประภา	\N	\N	3002	2563	105	1	3.97	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	1	10010006	1-9102-51140-50-9	\N	3	อรณิชา	\N	พงษ์ไพร	2	1	0	0	5	ถนนงามวงศ์วาน	\N	\N	3005	2559	113	2	2.03	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	6-1807-73944-45-6	\N	2	รัตนาภรณ์	\N	รักษ์ไทย	2	1	0	0	1	ถนนสาทร	\N	\N	3003	2563	105	2	2.38	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	8-1400-28312-43-5	\N	1	ธนาธิป	\N	วิริยะ	1	1	0	0	1	ถนนนิมมานเหมินท์	\N	\N	3001	2566	102	3	3.91	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	3-4860-98824-52-4	\N	1	ศุภณัฐ	\N	มณีรัตน์	1	1	0	0	3	ถ.บ้านโป่ง	\N	\N	3005	2562	106	2	2.97	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	7-2062-67353-26-8	\N	2	สมหญิง	\N	กิตติคุณ	2	1	0	0	6	ถ.เอกชัย	\N	\N	3004	2567	101	2	2.89	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	2-3944-61070-62-7	\N	1	ชาตรี	\N	วิไลวรรณ	1	1	0	0	2	ถนนช้างเผือก	\N	\N	3003	2560	112	1	2.58	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	8-1835-28197-18-6	\N	1	มานพ	\N	คงมั่น	1	1	0	0	1	ถนนเพชรเกษม	\N	\N	3005	2560	112	3	2.53	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	3-8742-91098-79-6	\N	1	สิรภพ	\N	สุขสันต์	1	1	0	0	9	ถนนศรีนครินทร์	\N	\N	3002	2557	422	3	2.1	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	5	10010006	1-4621-68972-24-2	\N	3	ลลิตา	\N	ดีสมัย	2	1	0	0	3	ถ.ประชาสามัคคี	\N	\N	3002	2563	105	1	3.66	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	2-5715-33692-20-2	\N	2	จิตรลดา	\N	ดำรงค์	2	1	0	0	7	ถนนศรีนครินทร์	\N	\N	3003	2561	111	2	3.4	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	3	10010006	1-5523-42955-34-7	\N	1	กิตติภณ	\N	สุขสันต์	1	1	0	0	5	ถนนสาทร	\N	\N	3004	2562	106	3	2.18	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	6-3305-12938-60-4	\N	3	ชลธิชา	\N	บุญมี	2	1	0	0	4	ถนนเยาวราช	\N	\N	3004	2567	103	1	2.69	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	7-2522-43145-28-3	\N	3	อภิญญา	\N	หอมหวาน	2	1	0	0	1	ถนนรัตนาธิเบศร์	\N	\N	3002	2558	421	3	3.56	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	6-3575-70531-75-1	\N	2	สมหญิง	\N	เพ็งพา	2	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	3004	2559	113	3	3	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	6-4572-15176-11-1	\N	3	รุ่งอรุณ	\N	จันทร์แก้ว	2	1	0	0	10	ถนนลาดพร้าว	\N	\N	3001	2567	101	1	2.78	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	7-8796-68450-52-5	\N	1	บุญยิ่ง	\N	สกุลดี	1	1	0	0	7	ถนนกลางเมือง	\N	\N	3002	2564	104	2	3.13	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	4-5739-45942-63-4	\N	3	สุภัสสรา	\N	เพ็งพา	2	1	0	0	4	ถนนศรีนครินทร์	\N	\N	3005	2564	104	2	3.38	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	2-6475-48887-62-4	\N	3	นภาพร	\N	อ่อนน้อม	2	1	0	0	6	ถนนรามคำแหง	\N	\N	3004	2559	113	2	3.88	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	8-7486-84564-96-7	\N	3	ชนิดา	\N	คงมั่น	2	1	0	0	6	ถนนกลางเมือง	\N	\N	3003	2566	102	3	3.05	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	6-3514-33899-82-7	\N	3	ชนิดา	\N	สุขสบาย	2	1	0	0	5	ถนนเจริญกรุง	\N	\N	3001	2559	113	3	2.44	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	5	10010006	3-6342-22134-43-6	\N	2	สมหญิง	\N	วงษ์สุวรรณ	2	1	0	0	6	ถ.เอกชัย	\N	\N	3001	2567	103	1	2.53	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	1-5473-19186-46-3	\N	2	สุมาลี	\N	บริบูรณ์	2	1	0	0	7	ถนนนิมมานเหมินท์	\N	\N	3002	2560	112	2	2.79	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	4-8973-30349-32-9	\N	1	ณัฐพล	\N	สมบูรณ์	1	1	0	0	3	ถนนรามคำแหง	\N	\N	3005	2566	102	1	3.32	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	5-4116-89444-29-3	\N	1	ทักษิณ	\N	สง่างาม	1	1	0	0	10	ถนนกลางเมือง	\N	\N	3002	2566	102	3	3.64	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	5	10010006	5-1419-70406-65-6	\N	1	ศุภณัฐ	\N	วังขวา	1	1	0	0	4	ถนนรัตนาธิเบศร์	\N	\N	3003	2566	102	2	3.85	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	1-1824-67449-74-3	\N	2	บุษยา	\N	เพียรดี	2	1	0	0	5	ถนนนิมมานเหมินท์	\N	\N	3003	2557	422	2	2.92	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	3	10010006	7-1079-99129-82-5	\N	3	อัมพร	\N	เจริญชัย	2	1	0	0	4	ถนนเจริญกรุง	\N	\N	3005	2567	101	3	3.34	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	1	10010006	3-6475-92996-64-3	\N	2	วาสนา	\N	สุจริต	2	1	0	0	10	ถ.เอกชัย	\N	\N	3003	2556	423	3	2.65	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	3-6364-68710-30-8	\N	1	วีรชัย	\N	เจริญชัย	1	1	0	0	4	ถนนนิมมานเหมินท์	\N	\N	3005	2563	105	1	3.61	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	4-5150-93628-42-7	\N	2	บุษยา	\N	ลือชา	2	1	0	0	7	ถนนสุดสาคร	\N	\N	3001	2564	104	2	2.52	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	7-2424-81676-16-7	\N	1	กิตติภณ	\N	สุวรรณภูมิ	1	1	0	0	9	ถนนสุดสาคร	\N	\N	3001	2567	101	3	3.59	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	8-3775-45630-42-5	\N	1	ธนพัฒน์	\N	ปัญญาดี	1	1	0	0	1	ถนนสุรวงศ์	\N	\N	3005	2557	422	3	3.49	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	4	10010006	5-5474-16166-81-9	\N	3	กัญญาณัฐ	\N	นิ่มนวล	2	1	0	0	4	ถนนสุรวงศ์	\N	\N	3003	2558	421	1	2.46	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	1	10010006	4-5388-71461-63-2	\N	1	ปิยังกูร	\N	พงษ์ไพร	1	1	0	0	3	ถนนสาทร	\N	\N	3005	2567	103	1	2.91	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	3-3620-13644-19-7	\N	2	ศิริพร	\N	ยิ้มแย้ม	2	1	0	0	4	ถนนเพชรเกษม	\N	\N	3005	2562	106	1	2.18	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	3-4543-19593-34-4	\N	2	ธัญชนก	\N	สุขสบาย	2	1	0	0	7	ถนนสาทร	\N	\N	3002	2566	102	3	2.65	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	5	10010006	3-8946-15963-33-4	\N	1	ศิวกร	\N	สง่างาม	1	1	0	0	2	ถนนประดิษฐ์มนูธรรม	\N	\N	3001	2567	103	3	2.52	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	1-5012-22803-94-8	\N	2	กาญจนา	\N	ทองดี	2	1	0	0	8	ถนนห้วยแก้ว	\N	\N	3001	2563	105	3	2.7	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	2-8584-59311-53-4	\N	2	ดรุณี	\N	สุขสบาย	2	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	3001	2564	104	3	3.25	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	5	10010006	2-6121-47313-73-5	\N	2	ปิยนุช	\N	หอมหวาน	2	1	0	0	7	ถนนรามคำแหง	\N	\N	3002	2559	113	2	2.23	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	5	10010006	8-3304-79866-33-1	\N	1	เจษฎา	\N	ยิ้มแย้ม	1	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	3001	2560	112	2	2.02	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	4-5637-92195-82-2	\N	1	ทักษิณ	\N	พงษ์ไพร	1	1	0	0	3	ถนนสาทร	\N	\N	3005	2561	111	3	3.88	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	1	10010006	4-3915-44773-99-2	\N	1	รัฐนนท์	\N	เจริญชัย	1	1	0	0	9	ถนนสีลม	\N	\N	3001	2561	111	2	3.75	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	3-6913-29340-93-1	\N	1	ณัฐวรรธน์	\N	ทั่วถึง	1	1	0	0	3	ถนนบรมราชชนนี	\N	\N	3003	2562	106	3	2.9	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	5-3713-79354-37-3	\N	1	รัฐนนท์	\N	จันทร์แก้ว	1	1	0	0	7	ถ.บ้านโป่ง	\N	\N	3004	2567	101	3	3.02	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	2-8094-71378-78-7	\N	1	ชนะชัย	\N	ทั่วถึง	1	1	0	0	3	ถนนพหลโยธิน	\N	\N	3001	2560	112	2	3.01	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	5-3773-66663-66-4	\N	1	ณัฐวุฒิ	\N	จันทร์แก้ว	1	1	0	0	1	ถนนราษฎร์บูรณะ	\N	\N	3003	2556	423	3	2.79	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	3	10010006	6-4419-93979-12-5	\N	1	กิตติภณ	\N	นิ่มนวล	1	1	0	0	1	ถนนกลางเมือง	\N	\N	3005	2556	423	1	2.97	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	6-1450-68636-51-6	\N	1	วรากร	\N	คงพิทักษ์	1	1	0	0	1	ถนนเจริญกรุง	\N	\N	3005	2567	103	1	2.31	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	8-2020-40498-73-9	\N	3	วาสนา	\N	เพ็งพา	2	1	0	0	5	ถนนอุดรดุษฎี	\N	\N	3005	2566	102	2	3.89	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	1-8364-61472-44-5	\N	3	เพ็ญพักตร์	\N	แสงสว่าง	2	1	0	0	1	ถนนช้างเผือก	\N	\N	3001	2561	111	3	3.51	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	8-3736-69580-92-8	\N	1	ณัฐวุฒิ	\N	วิไลวรรณ	1	1	0	0	4	ถนนสรงประภา	\N	\N	3001	2567	103	2	3.82	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	5	10010006	6-2768-21795-30-2	\N	1	สุทธิพงษ์	\N	มณีรัตน์	1	1	0	0	4	ถนนเยาวราช	\N	\N	3001	2561	111	1	2.43	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	5	10010006	1-6961-13862-32-5	\N	1	ภัคพล	\N	ดีสมัย	1	1	0	0	1	ถนนสุดสาคร	\N	\N	3004	2564	104	1	2.33	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	2-8551-16425-95-7	\N	2	ชลธิชา	\N	สุจริต	2	1	0	0	5	ถนนนวมินทร์	\N	\N	3004	2557	422	2	3.6	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	2-3679-43373-17-8	\N	3	ลลิตา	\N	วิริยะ	2	1	0	0	10	ถนนสุขุมวิท	\N	\N	3005	2566	102	1	3.45	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	2-2023-26291-22-5	\N	3	สมหญิง	\N	บุญรอด	2	1	0	0	6	ถนนมาลัยแมน	\N	\N	3001	2561	111	3	3.97	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	6-3117-45123-82-7	\N	3	ดวงใจ	\N	บริบูรณ์	2	1	0	0	1	ถนนเพชรเกษม	\N	\N	3004	2558	421	1	3.17	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	2-8916-71171-15-3	\N	2	ปัณฑิตา	\N	ธนาคาร	2	1	0	0	3	ถนนสาทร	\N	\N	3001	2567	103	2	2.75	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	3-8215-70351-94-3	\N	1	สิรภพ	\N	วังขวา	1	1	0	0	6	ถนนอ่อนนุช	\N	\N	3003	2562	106	2	2.9	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	5-9587-83928-81-8	\N	1	ณัฐพล	\N	นิ่มนวล	1	1	0	0	4	ถนนกลางเมือง	\N	\N	3003	2562	106	3	3.38	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	6-8743-99713-90-1	\N	3	ธัญชนก	\N	เพ็งพา	2	1	0	0	3	ถนนเยาวราช	\N	\N	3005	2560	112	1	2.43	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	4-9659-50414-59-5	\N	1	ทักษิณ	\N	พงษ์ไพร	1	1	0	0	9	ถนนวิภาวดีรังสิต	\N	\N	3005	2559	113	2	3.33	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	7-6682-27153-40-2	\N	3	อรณิชา	\N	พงษ์ไพร	2	1	0	0	9	ถนนประดิษฐ์มนูธรรม	\N	\N	3005	2563	105	1	2.64	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	4-4844-50860-10-7	\N	3	รุ่งอรุณ	\N	ประสิทธิ์ผล	2	1	0	0	3	ถนนรัตนาธิเบศร์	\N	\N	3002	2567	101	2	2.87	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	2	10010006	2-5289-27457-21-6	\N	1	รชานนท์	\N	สกุลดี	1	1	0	0	7	ถนนอ่อนนุช	\N	\N	3002	2562	106	2	3.56	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	1	10010006	5-4332-45506-47-3	\N	3	อภิญญา	\N	เกียรติสกุล	2	1	0	0	2	ถนนงามวงศ์วาน	\N	\N	3003	2564	104	3	3.83	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	6-8832-94088-46-3	\N	1	เจษฎา	\N	ชัยมงคล	1	1	0	0	2	ถนนประดิษฐ์มนูธรรม	\N	\N	3003	2556	423	2	2.59	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	2-3644-91794-24-2	\N	3	ธัญชนก	\N	เจริญชัย	2	1	0	0	7	ถนนกาญจนาภิเษก	\N	\N	3002	2561	111	1	3.82	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	8-3843-43185-66-4	\N	2	นวลจันทร์	\N	หอมหวาน	2	1	0	0	6	ถนนสาทร	\N	\N	3004	2564	104	1	3.26	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	2-5277-58311-93-2	\N	2	ทิพย์สุดา	\N	เกียรติสกุล	2	1	0	0	9	ถนนสีลม	\N	\N	3002	2557	422	1	2.93	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	1	10010006	3-5261-52504-35-2	\N	2	กาญจนา	\N	สุจริต	2	1	0	0	1	ถนนโชคชัย	\N	\N	3002	2564	104	2	3.92	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	7-3752-50440-36-1	\N	1	ปรเมศวร์	\N	หอมหวาน	1	1	0	0	2	ถนนกาญจนาภิเษก	\N	\N	3004	2557	422	1	3.49	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	7-7770-41764-67-5	\N	3	พิมพ์ชนก	\N	รุ่งเรือง	2	1	0	0	10	ถนนเพชรเกษม	\N	\N	3005	2559	113	1	3.45	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	7-6540-11173-64-2	\N	1	วรากร	\N	พรประเสริฐ	1	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	3004	2564	104	3	3.33	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	6-1036-28191-34-2	\N	1	สมชาย	\N	ชูศรี	1	1	0	0	7	ถนนลาดพร้าว	\N	\N	3001	2560	112	1	3.8	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	7-9379-39731-91-3	\N	1	สิรภพ	\N	งามดี	1	1	0	0	2	ถนนศรีนครินทร์	\N	\N	3001	2557	422	2	2.33	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	5-3310-58749-14-8	\N	1	นพรัตน์	\N	ประสิทธิ์ผล	1	1	0	0	10	ถนนสุดสาคร	\N	\N	3001	2561	111	3	3.46	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	2-5684-21111-45-5	\N	3	เพ็ญพักตร์	\N	วิริยะ	2	1	0	0	3	ถนนเยาวราช	\N	\N	3003	2558	421	1	3.86	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	7-2109-56394-84-6	\N	3	พิมพ์ชนก	\N	อินทร์ชัย	2	1	0	0	3	ถนนเจริญกรุง	\N	\N	3004	2562	106	1	3.41	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	8-9254-32339-85-4	\N	3	วันวิสา	\N	บริบูรณ์	2	1	0	0	1	ถนนช้างเผือก	\N	\N	3003	2566	102	3	3.16	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	4-7388-68140-65-1	\N	3	ศิริพร	\N	ดำรงค์	2	1	0	0	8	ถนนนิมมานเหมินท์	\N	\N	3004	2562	106	3	3.07	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	2-6184-10582-45-4	\N	1	กิตติภณ	\N	เกียรติสกุล	1	1	0	0	10	ถนนรัตนาธิเบศร์	\N	\N	3005	2566	102	3	2.91	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	1	10010006	7-7276-65775-11-7	\N	1	ชาตรี	\N	พรสวรรค์	1	1	0	0	4	ถนนมิตรภาพ	\N	\N	3004	2563	105	1	3.06	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	3-2426-17463-21-9	\N	3	แสงดาว	\N	ประสิทธิ์ผล	2	1	0	0	5	ถนนสรงประภา	\N	\N	3001	2563	105	2	3.69	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	3-5545-55250-84-5	\N	2	รัตนาภรณ์	\N	เจริญชัย	2	1	0	0	1	ถนนโชคชัย	\N	\N	3003	2564	104	1	3.15	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	3	10010006	5-5000-71686-68-6	\N	2	จิตรลดา	\N	วิไลวรรณ	2	1	0	0	1	ถ.ประชาสามัคคี	\N	\N	3004	2560	112	1	2.67	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	5-6777-30278-52-2	\N	3	แสงดาว	\N	สง่างาม	2	1	0	0	3	ถนนราษฎร์บูรณะ	\N	\N	3003	2564	104	1	3.07	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	8-6318-32268-30-8	\N	3	วันวิสา	\N	รุ่งเรือง	2	1	0	0	10	ถนนศรีนครินทร์	\N	\N	3004	2566	102	3	2.58	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	5-1864-28639-17-4	\N	3	ดรุณี	\N	วิไลวรรณ	2	1	0	0	9	ถนนช้างเผือก	\N	\N	3002	2564	104	3	2.92	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	5	10010006	6-2345-26895-46-3	\N	3	ปัณฑิตา	\N	สุขสบาย	2	1	0	0	7	ถนนห้วยแก้ว	\N	\N	3001	2564	104	2	3.57	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	4-8898-59167-41-6	\N	2	ชนิดา	\N	สุขสันต์	2	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	3005	2567	101	1	3.56	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	4	10010006	8-3358-78325-32-7	\N	2	ชลธิชา	\N	พรประเสริฐ	2	1	0	0	6	ถนนอ่อนนุช	\N	\N	3005	2566	102	3	3.24	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	2-8880-21144-59-1	\N	1	อนุชา	\N	วิริยะ	1	1	0	0	4	ถนนอ่อนนุช	\N	\N	3001	2564	104	1	3.48	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	5-5092-65002-93-7	\N	1	ณัฐพล	\N	วิริยะ	1	1	0	0	1	ถนนศรีนครินทร์	\N	\N	3003	2556	423	2	2.17	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	1	10010006	1-3594-99673-18-1	\N	1	วสันต์	\N	คงพิทักษ์	1	1	0	0	10	ถนนสุรวงศ์	\N	\N	3002	2560	112	1	2.94	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	7-6604-69787-58-5	\N	3	ศิริพร	\N	กิตติคุณ	2	1	0	0	6	ถนนมิตรภาพ	\N	\N	3004	2562	106	2	2.48	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	5-4310-56953-24-2	\N	2	เกวลิน	\N	คงมั่น	2	1	0	0	1	ถนนสรงประภา	\N	\N	3003	2564	104	1	3.3	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	3	10010006	1-9804-91037-27-4	\N	2	เพ็ญพักตร์	\N	ดำรงค์	2	1	0	0	4	ถนนอ่อนนุช	\N	\N	3003	2567	103	1	2.62	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	3	10010006	6-1466-70884-12-3	\N	1	นรวิชญ์	\N	เกียรติสกุล	1	1	0	0	7	ถนนเยาวราช	\N	\N	3001	2557	422	3	3.04	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	2-6240-92869-25-5	\N	1	ภัคพล	\N	บุญมี	1	1	0	0	5	ถนนโชคชัย	\N	\N	3004	2556	423	2	2.88	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	5-3225-69397-99-8	\N	2	อัมพร	\N	จันทร์แก้ว	2	1	0	0	4	ถนนรัตนาธิเบศร์	\N	\N	3004	2567	101	3	3.98	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	8-3766-55203-31-1	\N	1	มานพ	\N	พันธุ์ดี	1	1	0	0	3	ถนนสีลม	\N	\N	3001	2566	102	3	2.99	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	3-9798-44664-77-9	\N	2	วาสนา	\N	บริบูรณ์	2	1	0	0	10	ถนนบรมราชชนนี	\N	\N	3004	2557	422	1	2.75	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	5-6137-61587-94-5	\N	3	จิตรลดา	\N	วงษ์สุวรรณ	2	1	0	0	5	ถนนอุดรดุษฎี	\N	\N	3004	2562	106	3	3.16	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	6-3783-49735-29-9	\N	2	ชนิดา	\N	พงษ์ไพร	2	1	0	0	7	ถ.บ้านโป่ง	\N	\N	3005	2556	423	1	2.52	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	1	10010006	8-6679-15905-25-5	\N	3	เกวลิน	\N	กิตติคุณ	2	1	0	0	7	ถ.ประชาสามัคคี	\N	\N	3001	2567	101	3	3.38	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	6-1728-26800-74-1	\N	1	เอกพงษ์	\N	นิ่มนวล	1	1	0	0	1	ถนนนิมมานเหมินท์	\N	\N	3002	2567	101	2	2.71	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	7-1702-98201-41-2	\N	1	เจษฎา	\N	ลือชา	1	1	0	0	7	ถนนเพชรเกษม	\N	\N	3001	2560	112	1	2.54	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	2-7313-45152-54-8	\N	1	บุญยิ่ง	\N	ขาวสะอาด	1	1	0	0	6	ถนนศรีนครินทร์	\N	\N	3001	2564	104	3	3.31	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	5	10010006	4-3056-83603-61-8	\N	3	มณีรัตน์	\N	อ่อนน้อม	2	1	0	0	9	ถนนช้างเผือก	\N	\N	3002	2566	102	3	3.88	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	2-6693-56998-69-2	\N	1	สมชาย	\N	สุจริต	1	1	0	0	6	ถนนกลางเมือง	\N	\N	3001	2557	422	2	3.04	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	5-1706-84143-40-7	\N	3	แสงดาว	\N	วงษ์สุวรรณ	2	1	0	0	4	ถนนบายพาส	\N	\N	3004	2557	422	3	3.97	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	7-2909-19404-38-4	\N	2	สุนิสา	\N	ชัยมงคล	2	1	0	0	10	ถนนช้างเผือก	\N	\N	3005	2561	111	2	2.41	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	6-7470-89559-61-2	\N	2	กุลธิดา	\N	บุญมี	2	1	0	0	10	ถนนสรงประภา	\N	\N	3003	2556	423	1	3.02	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	5-7354-85986-72-9	\N	1	อภิวัฒน์	\N	อ่อนน้อม	1	1	0	0	5	ถนนเจริญกรุง	\N	\N	3004	2559	113	2	3.69	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	4-1957-55548-30-8	\N	3	ดรุณี	\N	ทั่วถึง	2	1	0	0	1	ถนนเยาวราช	\N	\N	3002	2566	102	3	3.14	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	2	10010006	2-7913-42825-27-4	\N	1	วีรชัย	\N	ดำรงค์	1	1	0	0	1	ถนนรามคำแหง	\N	\N	3002	2562	106	2	3.63	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	5	10010006	2-8993-61177-36-2	\N	1	สุรชัย	\N	พันธุ์ดี	1	1	0	0	10	ถนนบรมราชชนนี	\N	\N	3004	2557	422	3	3.53	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	4-7362-10580-63-3	\N	3	นลินทิพย์	\N	สุจริต	2	1	0	0	3	ถนนอ่อนนุช	\N	\N	3001	2558	421	2	3.33	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	6-9033-69608-57-7	\N	1	รชานนท์	\N	ดีสมัย	1	1	0	0	10	ถนนวิภาวดีรังสิต	\N	\N	3003	2566	102	2	2.81	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	3	10010006	5-1137-14631-37-3	\N	1	ชูเกียรติ	\N	คงพิทักษ์	1	1	0	0	8	ถนนสาทร	\N	\N	3005	2567	101	1	2.5	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	8-5990-59930-36-6	\N	1	นรวิชญ์	\N	งามดี	1	1	0	0	3	ถนนสีลม	\N	\N	3002	2564	104	3	2.51	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	5	10010006	1-4978-80784-10-7	\N	2	สุนิสา	\N	ศรีสุข	2	1	0	0	10	ถนนช้างเผือก	\N	\N	3005	2558	421	3	3.51	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	2-2687-22305-93-3	\N	2	อรณิชา	\N	ศักดิ์สิทธิ์	2	1	0	0	9	ถนนบรมราชชนนี	\N	\N	3003	2560	112	3	3.94	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	4-7427-95318-88-5	\N	2	ศิริพร	\N	พรสวรรค์	2	1	0	0	8	ถนนศรีนครินทร์	\N	\N	3002	2564	104	2	2.89	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	5-6509-11333-34-4	\N	1	ชัยชนะ	\N	พงษ์ไพร	1	1	0	0	8	ถนนรัตนาธิเบศร์	\N	\N	3002	2556	423	2	3.16	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	8-6918-38666-54-4	\N	1	บุญยิ่ง	\N	เพียรดี	1	1	0	0	2	ถนนอ่อนนุช	\N	\N	3005	2557	422	1	3.67	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	6-7792-69195-22-6	\N	1	สมศักดิ์	\N	หอมหวาน	1	1	0	0	1	ถนนสุรวงศ์	\N	\N	3003	2559	113	3	2.9	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	2-3061-62168-52-3	\N	1	ประพันธ์	\N	ประสิทธิ์ผล	1	1	0	0	5	ถนนวิภาวดีรังสิต	\N	\N	3005	2560	112	3	2.12	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	3-1065-19677-51-2	\N	1	ธนพัฒน์	\N	สุวรรณภูมิ	1	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	3002	2561	111	3	2.63	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	1	10010006	2-7688-56143-66-7	\N	3	ศิริพร	\N	นามมนตรี	2	1	0	0	6	ถนนสรงประภา	\N	\N	3005	2556	423	1	2.8	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	1	10010006	5-1388-27175-82-5	\N	1	ปรเมศวร์	\N	วังขวา	1	1	0	0	9	ถนนเยาวราช	\N	\N	3004	2559	113	3	3.31	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	7-7473-20069-40-9	\N	3	กุลธิดา	\N	ทั่วถึง	2	1	0	0	9	ถนนอุดรดุษฎี	\N	\N	3003	2556	423	2	3.67	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	6-7558-68143-75-4	\N	3	สมหญิง	\N	มณีรัตน์	2	1	0	0	3	ถนนสาทร	\N	\N	3001	2561	111	1	3.46	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	2-3526-93508-68-1	\N	2	ประภา	\N	เจริญชัย	2	1	0	0	7	ถนนบายพาส	\N	\N	3001	2564	104	3	3.6	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	8-9763-15451-66-3	\N	1	นพรัตน์	\N	สง่างาม	1	1	0	0	1	ถนนสรงประภา	\N	\N	3003	2562	106	2	2.07	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	2-3587-11495-83-7	\N	1	วิชญ์พล	\N	ยิ้มแย้ม	1	1	0	0	7	ถ.เอกชัย	\N	\N	3002	2557	422	3	2.2	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	2	10010006	5-5099-75966-38-7	\N	3	พรทิพย์	\N	เพ็งพา	2	1	0	0	6	ถนนมาลัยแมน	\N	\N	3001	2567	101	3	3.17	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	5	10010006	6-7645-96422-51-8	\N	3	พิมพ์ชนก	\N	ยิ้มแย้ม	2	1	0	0	5	ถนนอ่อนนุช	\N	\N	3001	2559	113	3	3.39	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	4-4997-19947-60-5	\N	3	ศิริพร	\N	ทองดี	2	1	0	0	10	ถนนพหลโยธิน	\N	\N	3003	2561	111	2	3.67	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	1-6796-77827-74-7	\N	3	อภิญญา	\N	ศักดิ์สิทธิ์	2	1	0	0	9	ถนนรามคำแหง	\N	\N	3005	2557	422	3	3.93	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	1	10010006	3-7920-64994-26-6	\N	1	ดิศรณ์	\N	ชัยมงคล	1	1	0	0	5	ถ.บ้านโป่ง	\N	\N	3002	2559	113	1	3.94	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	1-2484-48519-59-2	\N	1	ณัฐวรรธน์	\N	ทองดี	1	1	0	0	6	ถ.รัฐพัฒนา	\N	\N	3005	2560	112	3	2.1	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	1-8385-37477-76-9	\N	1	กิตติภณ	\N	มณีรัตน์	1	1	0	0	6	ถนนเยาวราช	\N	\N	3001	2566	102	3	2.58	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	1-6991-82616-18-4	\N	1	ธนพัฒน์	\N	ทั่วถึง	1	1	0	0	9	ถนนลาดพร้าว	\N	\N	3004	2557	422	2	3.1	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	7-4800-85200-91-1	\N	2	ลลิตา	\N	ยิ้มแย้ม	2	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	3003	2567	101	2	2.87	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	7-9156-18871-77-4	\N	1	นรวิชญ์	\N	จันทร์แก้ว	1	1	0	0	3	ถนนเพชรเกษม	\N	\N	3005	2559	113	2	3.89	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	5-3869-56984-90-2	\N	1	ธนภัทร	\N	สุวรรณภูมิ	1	1	0	0	2	ถนนบรมราชชนนี	\N	\N	3003	2567	103	3	3.17	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	1-5813-31764-94-5	\N	1	ชินดนัย	\N	งามดี	1	1	0	0	2	ถนนศรีนครินทร์	\N	\N	3003	2567	101	2	3.79	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	4-3285-42362-81-9	\N	3	ดรุณี	\N	นิ่มนวล	2	1	0	0	8	ถนนมาลัยแมน	\N	\N	3005	2561	111	1	3.51	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	6-2163-36478-49-1	\N	3	นภาพร	\N	ทองดี	2	1	0	0	4	ถ.เอกชัย	\N	\N	3004	2567	101	3	3.29	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	4-1349-79212-22-9	\N	1	ปิยังกูร	\N	บริบูรณ์	1	1	0	0	4	ถนนมาลัยแมน	\N	\N	3003	2564	104	3	3.46	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	8-1139-33640-59-7	\N	1	ดิศรณ์	\N	สุดสวย	1	1	0	0	4	ถนนโชคชัย	\N	\N	3005	2556	423	3	3.25	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	6-2920-39158-38-2	\N	1	ธนภัทร	\N	ลือชา	1	1	0	0	2	ถ.เอกชัย	\N	\N	3001	2557	422	2	3.12	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	3-3208-14373-39-1	\N	3	วรรณภา	\N	มีสุข	2	1	0	0	3	ถนนเจริญกรุง	\N	\N	3004	2557	422	2	2.99	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	3-4903-99073-11-4	\N	3	ชนิดา	\N	นามมนตรี	2	1	0	0	7	ถนนพหลโยธิน	\N	\N	3001	2567	103	3	3.32	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	3-5362-88262-70-3	\N	3	ลลิตา	\N	พรประเสริฐ	2	1	0	0	7	ถนนห้วยแก้ว	\N	\N	3004	2566	102	3	3.81	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	7-8809-43916-99-6	\N	3	ประภา	\N	ใจดี	2	1	0	0	2	ถนนนิมมานเหมินท์	\N	\N	3002	2558	421	2	3.15	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	5-9490-79709-28-6	\N	3	พรทิพย์	\N	สุวรรณภูมิ	2	1	0	0	3	ถนนมาลัยแมน	\N	\N	3002	2558	421	2	3.44	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	2-2838-51244-65-8	\N	1	สมศักดิ์	\N	ศรีสุข	1	1	0	0	4	ถนนสีลม	\N	\N	3005	2567	103	1	3.57	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	1-7033-17901-94-7	\N	3	ชลธิชา	\N	บริบูรณ์	2	1	0	0	9	ถนนพหลโยธิน	\N	\N	3004	2563	105	3	2.84	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	7-6302-17934-32-8	\N	1	ธนพัฒน์	\N	ทั่วถึง	1	1	0	0	6	ถนนโชคชัย	\N	\N	3002	2560	112	3	2.45	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	4-4384-80841-83-3	\N	2	วรรณภา	\N	ยิ้มแย้ม	2	1	0	0	4	ถนนนิมมานเหมินท์	\N	\N	3003	2557	422	2	2.41	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	6-6525-71670-77-3	\N	3	อรณิชา	\N	สง่างาม	2	1	0	0	7	ถนนอ่อนนุช	\N	\N	3003	2561	111	1	2.81	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	3	10010006	3-8601-21622-58-2	\N	1	วสันต์	\N	ดีสมัย	1	1	0	0	9	ถนนบายพาส	\N	\N	3002	2561	111	3	3.53	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	5-8887-64783-33-4	\N	1	สมศักดิ์	\N	สุดสวย	1	1	0	0	8	ถนนสุขุมวิท	\N	\N	3005	2563	105	3	3.87	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	8-4037-64160-77-2	\N	1	ณัฐวรรธน์	\N	ศักดิ์สิทธิ์	1	1	0	0	10	ถนนอ่อนนุช	\N	\N	3003	2558	421	2	3.12	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	3-4652-28284-75-1	\N	1	ทักษิณ	\N	รักษ์ไทย	1	1	0	0	7	ถนนศรีนครินทร์	\N	\N	3002	2559	113	2	2.18	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	5	10010006	6-5558-18444-79-3	\N	3	นลินทิพย์	\N	สีดา	2	1	0	0	6	ถนนนวมินทร์	\N	\N	3001	2560	112	2	2.55	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	4-1458-36610-30-9	\N	1	ศุภณัฐ	\N	หอมหวาน	1	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	3001	2567	101	1	3.02	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	5	10010006	8-9956-59847-56-8	\N	3	กุลธิดา	\N	เพียรดี	2	1	0	0	2	ถนนอุดรดุษฎี	\N	\N	3003	2559	113	1	2.62	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	1-9593-64765-32-9	\N	2	นวลจันทร์	\N	วงษ์สุวรรณ	2	1	0	0	7	ถนนนวมินทร์	\N	\N	3002	2566	102	3	3.69	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	3-4455-12658-83-3	\N	3	นภาพร	\N	ยิ้มแย้ม	2	1	0	0	6	ถนนนวมินทร์	\N	\N	3002	2567	103	2	2.9	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	2	10010006	7-4315-41992-12-9	\N	3	ธัญชนก	\N	ประสิทธิ์ผล	2	1	0	0	5	ถนนบายพาส	\N	\N	3004	2563	105	2	2.42	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	1-4860-37195-99-7	\N	1	ชนะชัย	\N	ลือชา	1	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	3002	2567	103	1	3.13	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	1	10010006	4-5163-95458-38-1	\N	3	รุ่งอรุณ	\N	พันธุ์ดี	2	1	0	0	4	ถนนเพชรเกษม	\N	\N	3005	2567	103	3	2.36	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	4	10010006	7-8070-33451-28-9	\N	1	สมศักดิ์	\N	สุดสวย	1	1	0	0	5	ถนนกลางเมือง	\N	\N	3001	2564	104	2	2.62	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	5	10010006	7-3494-31343-83-6	\N	2	สุดารัตน์	\N	พันธุ์ดี	2	1	0	0	2	ถนนเพชรเกษม	\N	\N	3001	2566	102	3	3	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	7-1716-96484-17-3	\N	1	ธนพัฒน์	\N	ขาวสะอาด	1	1	0	0	7	ถนนพหลโยธิน	\N	\N	3005	2567	103	1	2.27	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	4	10010006	6-4264-76992-91-2	\N	2	สุนิสา	\N	ยิ้มแย้ม	2	1	0	0	7	ถนนสรงประภา	\N	\N	3001	2563	105	2	3.22	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	5-6233-71687-38-3	\N	2	อภิญญา	\N	มณีรัตน์	2	1	0	0	2	ถนนอุดรดุษฎี	\N	\N	3004	2564	104	3	3.08	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	4-6677-44875-42-1	\N	2	วรรณภา	\N	สุจริต	2	1	0	0	8	ถนนงามวงศ์วาน	\N	\N	3003	2559	113	1	3.55	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	1-3767-41966-94-1	\N	1	ชัยชนะ	\N	สุขสบาย	1	1	0	0	6	ถนนสุขุมวิท	\N	\N	3004	2560	112	3	3.03	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	4-4263-25998-73-2	\N	3	อัมพร	\N	จันทร์แก้ว	2	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	3003	2556	423	2	2.47	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	3-5795-85889-32-3	\N	3	มณีรัตน์	\N	ทั่วถึง	2	1	0	0	1	ถนนศรีนครินทร์	\N	\N	3001	2567	103	3	3.85	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	6-3272-24504-66-7	\N	1	สมชาย	\N	ธนาคาร	1	1	0	0	9	ถนนพหลโยธิน	\N	\N	3002	2556	423	3	3.17	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	1-6367-17477-71-4	\N	1	ดิศรณ์	\N	รุ่งเรือง	1	1	0	0	3	ถนนกาญจนาภิเษก	\N	\N	3005	2556	423	1	2.67	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	3-6986-16006-31-8	\N	1	วิชญ์พล	\N	คงพิทักษ์	1	1	0	0	5	ถนนสุดสาคร	\N	\N	3003	2563	105	1	2.49	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	4-8894-94195-60-6	\N	1	ปัณณทัต	\N	ศักดิ์สิทธิ์	1	1	0	0	5	ถนนสาทร	\N	\N	3002	2561	111	2	2.73	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	1	10010006	1-9564-63855-91-5	\N	3	นันทพร	\N	ทั่วถึง	2	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	3005	2566	102	1	2.84	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	6-1333-53607-17-5	\N	2	นวลจันทร์	\N	สุขสันต์	2	1	0	0	9	ถ.บ้านโป่ง	\N	\N	3002	2562	106	3	2.09	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	4-8645-73992-31-2	\N	1	ชาตรี	\N	ชูศรี	1	1	0	0	1	ถนนรัตนาธิเบศร์	\N	\N	3001	2567	101	1	3.34	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	5	10010006	2-2175-71822-25-8	\N	3	ปาณิสรา	\N	หอมหวาน	2	1	0	0	5	ถนนพหลโยธิน	\N	\N	3004	2562	106	3	2.46	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	5-9682-61921-52-8	\N	1	ชินดนัย	\N	วังขวา	1	1	0	0	4	ถ.เอกชัย	\N	\N	3003	2564	104	2	3.15	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	1	10010006	7-7200-17608-47-8	\N	3	อภิญญา	\N	ประสิทธิ์ผล	2	1	0	0	5	ถนนเพชรเกษม	\N	\N	3004	2560	112	2	2.27	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	4-9209-93808-29-6	\N	1	ธนภัทร	\N	ศักดิ์สิทธิ์	1	1	0	0	3	ถนนนวมินทร์	\N	\N	3001	2566	102	1	2.79	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	1-3240-61894-87-6	\N	3	พิมพ์ชนก	\N	คงมั่น	2	1	0	0	8	ถ.ประชาสามัคคี	\N	\N	3005	2556	423	2	2.23	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	4-2616-66014-35-7	\N	3	อรณิชา	\N	รุ่งเรือง	2	1	0	0	8	ถนนเจริญกรุง	\N	\N	3005	2563	105	3	3.87	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	4	10010008	5-2182-23563-13-1	\N	3	อภิญญา	\N	บุญมี	2	1	0	0	3	ถนนลาดพร้าว	\N	\N	7302	2562	106	2	3.16	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010006	4-6542-41995-72-7	\N	1	เจษฎา	\N	วิไลวรรณ	1	1	0	0	5	ถนนราษฎร์บูรณะ	\N	\N	3002	2567	101	3	3.33	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	1	10010006	6-4937-88566-56-3	\N	1	ทัศนัย	\N	นิ่มนวล	1	1	0	0	7	ถนนลาดพร้าว	\N	\N	3002	2567	101	1	3.93	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	1-2523-21021-42-8	\N	2	กุลธิดา	\N	คงพิทักษ์	2	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	3005	2563	105	1	2.58	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	4	10010006	1-7832-70138-78-2	\N	3	อภิญญา	\N	ดีสมัย	2	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	3004	2567	101	1	2.91	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	2-1513-96943-35-5	\N	3	นภาพร	\N	ดำรงค์	2	1	0	0	1	ถนนช้างเผือก	\N	\N	3004	2561	111	1	3.3	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	1-5806-24353-96-8	\N	3	สิริมา	\N	บุญรอด	2	1	0	0	6	ถนนอุดรดุษฎี	\N	\N	3005	2567	103	1	3.13	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	1	10010006	8-8437-18959-96-7	\N	2	สิริมา	\N	ลือชา	2	1	0	0	10	ถนนเพชรเกษม	\N	\N	3002	2556	423	3	3.01	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	2-2945-14200-43-9	\N	3	ชนิดา	\N	สมบูรณ์	2	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	3002	2563	105	1	2.62	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	2-3352-86919-25-3	\N	2	ลลิตา	\N	รักษ์ไทย	2	1	0	0	8	ถนนประดิษฐ์มนูธรรม	\N	\N	3004	2562	106	2	3.39	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	7-1423-93646-77-5	\N	2	นวลจันทร์	\N	หอมหวาน	2	1	0	0	2	ถนนมิตรภาพ	\N	\N	3005	2561	111	1	3.32	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	1	10010006	4-8466-64568-36-2	\N	2	ทิพย์สุดา	\N	บริบูรณ์	2	1	0	0	9	ถนนห้วยแก้ว	\N	\N	3002	2564	104	3	3.63	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	5-5182-81753-22-5	\N	3	ดรุณี	\N	กิตติคุณ	2	1	0	0	5	ถนนพหลโยธิน	\N	\N	3001	2558	421	1	2.87	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	1-3441-41253-25-1	\N	1	ณัฐพล	\N	ทั่วถึง	1	1	0	0	7	ถนนนิมมานเหมินท์	\N	\N	3003	2560	112	2	2.74	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	3-3891-83638-74-6	\N	1	กวินท์	\N	สง่างาม	1	1	0	0	5	ถนนชัยพฤกษ์	\N	\N	3005	2567	103	1	3.25	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	4	10010006	3-7141-25061-92-8	\N	3	สิริมา	\N	หอมหวาน	2	1	0	0	4	ถนนมาลัยแมน	\N	\N	3005	2558	421	3	3.65	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	8-4987-97402-71-2	\N	3	สมหญิง	\N	นามมนตรี	2	1	0	0	1	ถนนห้วยแก้ว	\N	\N	3004	2557	422	3	3.8	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	1-8047-74954-68-2	\N	1	มานพ	\N	ทั่วถึง	1	1	0	0	9	ถนนห้วยแก้ว	\N	\N	3002	2563	105	3	3.43	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	1	10010006	4-1328-43709-17-3	\N	1	สมศักดิ์	\N	ประสิทธิ์ผล	1	1	0	0	6	ถนนบายพาส	\N	\N	3001	2566	102	2	2.93	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	7-9097-70928-55-3	\N	1	กิตติภณ	\N	พันธุ์ดี	1	1	0	0	8	ถนนพหลโยธิน	\N	\N	3001	2559	113	1	2.82	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	4-6337-11215-62-5	\N	2	สุภัสสรา	\N	มีสุข	2	1	0	0	3	ถ.รัฐพัฒนา	\N	\N	3005	2558	421	1	2.88	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	1	10010006	2-8980-63372-69-7	\N	1	สุทธิพงษ์	\N	สีดา	1	1	0	0	3	ถนนราษฎร์บูรณะ	\N	\N	3005	2561	111	3	2.73	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	7-4803-85307-18-6	\N	2	ปัณฑิตา	\N	ทั่วถึง	2	1	0	0	9	ถนนนิมมานเหมินท์	\N	\N	3003	2563	105	1	3.9	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	7-8657-77157-30-1	\N	3	อภิญญา	\N	บุญมี	2	1	0	0	4	ถนนอุดรดุษฎี	\N	\N	3003	2567	101	1	3.74	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	3	10010006	6-1537-96916-33-7	\N	1	ธัชพล	\N	สุดสวย	1	1	0	0	2	ถนนสุรวงศ์	\N	\N	3001	2560	112	3	3.59	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	1-8077-60315-66-7	\N	3	ณัฐนิชา	\N	อินทร์ชัย	2	1	0	0	7	ถนนห้วยแก้ว	\N	\N	3001	2566	102	1	3.69	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	2-7748-84081-45-4	\N	2	นวลจันทร์	\N	วิไลวรรณ	2	1	0	0	6	ถนนสีลม	\N	\N	3002	2561	111	2	2.48	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010009	6-1023-18428-82-2	\N	2	ณัฐนิชา	\N	มีสุข	2	1	0	0	7	ถนนกลางเมือง	\N	\N	9203	2567	101	1	2.99	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010006	8-7305-48877-55-6	\N	2	ลลิตา	\N	สมบูรณ์	2	1	0	0	6	ถนนสรงประภา	\N	\N	3001	2562	106	2	3.55	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	6-6986-75237-11-6	\N	3	สุภัสสรา	\N	ศรีสุข	2	1	0	0	3	ถนนกลางเมือง	\N	\N	3001	2563	105	1	3.99	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	3-4128-55045-96-9	\N	1	นพรัตน์	\N	ประสิทธิ์ผล	1	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	3005	2560	112	2	2.58	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	4-6138-66477-13-1	\N	1	ณัฐวุฒิ	\N	ศักดิ์สิทธิ์	1	1	0	0	7	ถนนศรีนครินทร์	\N	\N	3004	2562	106	1	3.75	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	8-6951-19903-84-4	\N	3	รุ่งอรุณ	\N	ใจดี	2	1	0	0	8	ถนนเจริญกรุง	\N	\N	3003	2566	102	2	3.7	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	5-5115-53808-77-1	\N	3	มาลัย	\N	คงมั่น	2	1	0	0	2	ถ.บ้านโป่ง	\N	\N	3001	2559	113	2	3.61	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	7-5542-99554-58-2	\N	2	ดวงใจ	\N	ศรีสุข	2	1	0	0	6	ถนนชัยพฤกษ์	\N	\N	3002	2562	106	2	3.53	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	2	10010006	8-1641-98671-75-2	\N	2	เกวลิน	\N	รักษ์ไทย	2	1	0	0	1	ถนนเพชรเกษม	\N	\N	3002	2558	421	3	3.58	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	5-1713-82817-86-5	\N	2	ปิยนุช	\N	เพ็งพา	2	1	0	0	4	ถ.ประชาสามัคคี	\N	\N	3005	2567	103	1	3.31	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	4	10010006	4-1135-11861-76-1	\N	2	กัญญา	\N	พรสวรรค์	2	1	0	0	6	ถนนโชคชัย	\N	\N	3002	2564	104	3	2.4	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	1	10010006	1-4155-38394-46-1	\N	1	ชาตรี	\N	มงคล	1	1	0	0	6	ถนนลาดพร้าว	\N	\N	3005	2563	105	3	2.24	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	4-6591-94092-76-7	\N	1	อนุชา	\N	สีดา	1	1	0	0	10	ถนนลาดพร้าว	\N	\N	3001	2564	104	2	3.97	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	7-5971-64790-12-3	\N	1	ชนะชัย	\N	สง่างาม	1	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	3002	2563	105	1	2.82	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	3-6680-84184-77-4	\N	3	อัมพร	\N	สุขสันต์	2	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	3004	2558	421	1	3.01	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	5-6259-88488-19-3	\N	1	เจษฎา	\N	ปัญญาดี	1	1	0	0	7	ถนนพหลโยธิน	\N	\N	3003	2560	112	3	3.65	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	1	10010006	7-7052-64690-97-6	\N	1	ธนภัทร	\N	พงษ์ไพร	1	1	0	0	8	ถนนรามคำแหง	\N	\N	3002	2561	111	3	3.72	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	1	10010006	6-1939-49741-40-9	\N	3	จิราพร	\N	กิตติคุณ	2	1	0	0	10	ถนนสุดสาคร	\N	\N	3005	2558	421	1	2.05	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	3-6291-34907-26-3	\N	2	นวลจันทร์	\N	ประสิทธิ์ผล	2	1	0	0	4	ถนนสุขุมวิท	\N	\N	3003	2561	111	1	3.15	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	3-7770-22941-37-6	\N	3	นันทพร	\N	สีดา	2	1	0	0	6	ถ.บ้านโป่ง	\N	\N	3005	2562	106	2	2.51	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	1	10010006	4-5020-50932-14-9	\N	3	ชนิดา	\N	ศรีสุข	2	1	0	0	4	ถนนกลางเมือง	\N	\N	3005	2558	421	3	2.65	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	4	10010006	2-3817-11989-65-7	\N	3	สมหญิง	\N	สุขสันต์	2	1	0	0	6	ถนนบายพาส	\N	\N	3002	2557	422	3	3.06	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	7-3674-28200-40-7	\N	1	ธนาธิป	\N	เกียรติสกุล	1	1	0	0	9	ถนนสุรวงศ์	\N	\N	3005	2562	106	1	3.9	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	4-6642-54461-91-8	\N	1	ธนาธิป	\N	ลือชา	1	1	0	0	9	ถนนลาดพร้าว	\N	\N	3003	2567	101	2	2.68	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	1	10010006	1-7889-27032-82-5	\N	1	ปรเมศวร์	\N	วิริยะ	1	1	0	0	6	ถนนสุขุมวิท	\N	\N	3001	2563	105	2	2.99	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	6-4498-46382-22-5	\N	1	เอกพงษ์	\N	เจริญชัย	1	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	3005	2557	422	2	2.91	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	7-7995-71428-83-1	\N	1	เอกพงษ์	\N	คงมั่น	1	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	3002	2564	104	3	3.46	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	2	10010006	2-2302-96752-17-5	\N	3	วันวิสา	\N	ลือชา	2	1	0	0	1	ถนนประดิษฐ์มนูธรรม	\N	\N	3004	2567	103	1	3.48	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	1-2391-94202-79-8	\N	1	ธนพัฒน์	\N	หอมหวาน	1	1	0	0	8	ถ.เอกชัย	\N	\N	3002	2559	113	3	2.35	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	2	10010006	4-3124-27554-43-3	\N	2	นวลจันทร์	\N	ดีสมัย	2	1	0	0	6	ถ.บ้านโป่ง	\N	\N	3003	2563	105	1	2.65	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	3	10010006	6-1784-31607-23-9	\N	2	ลลิตา	\N	บริบูรณ์	2	1	0	0	9	ถนนมิตรภาพ	\N	\N	3004	2563	105	2	2.89	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	1-4723-59605-34-9	\N	1	ศุภณัฐ	\N	จันทร์แก้ว	1	1	0	0	4	ถนนสุดสาคร	\N	\N	3003	2566	102	2	3.15	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	3	10010006	4-7037-96951-74-5	\N	3	บุษยา	\N	สมบูรณ์	2	1	0	0	8	ถ.เอกชัย	\N	\N	3001	2563	105	2	2.66	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	5	10010006	4-3143-94569-91-1	\N	1	วีรชัย	\N	ดำรงค์	1	1	0	0	3	ถนนห้วยแก้ว	\N	\N	3002	2559	113	1	3.05	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	7-8292-94521-67-9	\N	2	สุนิสา	\N	มงคล	2	1	0	0	2	ถนนเจริญกรุง	\N	\N	3004	2567	103	3	3.91	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	5-6374-86778-27-2	\N	3	สิริมา	\N	ทั่วถึง	2	1	0	0	2	ถนนประดิษฐ์มนูธรรม	\N	\N	3001	2559	113	3	2.65	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	5-8546-38018-73-8	\N	3	วันวิสา	\N	สมบูรณ์	2	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	3002	2556	423	3	2.1	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	5	10010006	6-5785-83757-89-8	\N	1	ธัชพล	\N	สุจริต	1	1	0	0	8	ถนนบรมราชชนนี	\N	\N	3002	2556	423	3	2.76	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	1	10010006	2-1380-13952-22-5	\N	2	กัญญา	\N	พรสวรรค์	2	1	0	0	3	ถนนโชคชัย	\N	\N	3002	2557	422	1	3.1	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	6-9002-52383-85-6	\N	3	รุ่งอรุณ	\N	คงพิทักษ์	2	1	0	0	2	ถนนเยาวราช	\N	\N	3001	2567	101	1	2.98	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	1-9376-11038-10-5	\N	1	สุทธิพงษ์	\N	สุดสวย	1	1	0	0	6	ถนนโชคชัย	\N	\N	3004	2561	111	1	3.34	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	5-7456-65514-54-3	\N	3	ธัญชนก	\N	เพ็งพา	2	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	3002	2562	106	3	3.8	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	3-6437-18381-33-4	\N	1	กิตติภณ	\N	สุวรรณภูมิ	1	1	0	0	5	ถนนสาทร	\N	\N	3001	2558	421	1	3.17	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	8-9154-68232-37-5	\N	1	ณัฐวุฒิ	\N	อินทร์ชัย	1	1	0	0	3	ถนนบายพาส	\N	\N	3004	2559	113	2	3.35	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	5-8169-88546-21-5	\N	3	บุษยา	\N	วิไลวรรณ	2	1	0	0	1	ถ.เอกชัย	\N	\N	3001	2562	106	3	2.14	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	1-8886-44629-60-7	\N	2	ชลธิชา	\N	วิริยะ	2	1	0	0	7	ถ.บ้านโป่ง	\N	\N	3001	2558	421	1	3.88	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	3-5748-40181-57-7	\N	2	กาญจนา	\N	ธนาคาร	2	1	0	0	7	ถนนโชคชัย	\N	\N	3001	2558	421	1	3.5	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	7-7090-28927-56-6	\N	1	เอกพงษ์	\N	แสงสว่าง	1	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	3002	2561	111	2	3.56	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	1-9179-33050-76-4	\N	2	ศิริพร	\N	วิไลวรรณ	2	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	3001	2558	421	3	3.52	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	2-5264-89874-99-4	\N	3	นภาพร	\N	สีดา	2	1	0	0	7	ถนนสุรวงศ์	\N	\N	3004	2564	104	1	3.42	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	5-5188-39224-84-1	\N	1	ชูเกียรติ	\N	ดำรงค์	1	1	0	0	10	ถนนห้วยแก้ว	\N	\N	3004	2564	104	2	2.8	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	1-2010-95451-60-4	\N	1	วสันต์	\N	คงพิทักษ์	1	1	0	0	7	ถนนชัยพฤกษ์	\N	\N	3003	2562	106	2	2.44	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	8-1908-49381-74-2	\N	1	ณัฐพล	\N	สุวรรณภูมิ	1	1	0	0	2	ถนนสาทร	\N	\N	3001	2567	101	2	2.58	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	3-8909-92392-30-6	\N	2	ประภา	\N	สุดสวย	2	1	0	0	10	ถนนนวมินทร์	\N	\N	3004	2560	112	3	2.83	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	1-8769-21687-33-7	\N	3	ลลิตา	\N	ลือชา	2	1	0	0	10	ถนนเพชรเกษม	\N	\N	3001	2566	102	2	2.95	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	4-4553-23745-37-3	\N	2	วิมลรัตน์	\N	ปัญญาดี	2	1	0	0	7	ถนนโชคชัย	\N	\N	3004	2567	101	1	3.49	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	4-8119-81437-78-5	\N	1	สุรชัย	\N	ปัญญาดี	1	1	0	0	2	ถนนกลางเมือง	\N	\N	3003	2566	102	1	2.73	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	3-7134-18273-85-6	\N	2	กาญจนา	\N	สุดสวย	2	1	0	0	7	ถนนบรมราชชนนี	\N	\N	3002	2557	422	1	3.05	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	5	10010006	6-6923-26992-98-9	\N	3	อัมพร	\N	ชัยมงคล	2	1	0	0	6	ถนนประดิษฐ์มนูธรรม	\N	\N	3005	2566	102	1	2.73	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	1	10010006	3-9961-33243-87-4	\N	2	รุ่งอรุณ	\N	สกุลดี	2	1	0	0	4	ถนนมิตรภาพ	\N	\N	3002	2567	101	3	2.73	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	5	10010006	6-4176-55973-86-7	\N	1	ปิยังกูร	\N	มงคล	1	1	0	0	5	ถ.บ้านโป่ง	\N	\N	3004	2557	422	3	3	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	6-6258-14433-68-3	\N	1	รชานนท์	\N	พรประเสริฐ	1	1	0	0	9	ถนนสุรวงศ์	\N	\N	3003	2562	106	2	2.82	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	1-9623-81608-16-9	\N	1	ทัศนัย	\N	สุขสบาย	1	1	0	0	8	ถนนห้วยแก้ว	\N	\N	3001	2556	423	2	3.45	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	2-1196-51950-77-1	\N	3	วันวิสา	\N	ปัญญาดี	2	1	0	0	2	ถนนพหลโยธิน	\N	\N	3003	2560	112	3	3.36	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	3	10010006	4-8316-79650-80-7	\N	3	ศิริพร	\N	พรสวรรค์	2	1	0	0	7	ถนนอ่อนนุช	\N	\N	3003	2560	112	2	2.87	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	8-8252-46241-83-7	\N	3	สมหญิง	\N	เจริญชัย	2	1	0	0	4	ถนนอ่อนนุช	\N	\N	3003	2558	421	1	2.47	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	2-6651-10067-33-4	\N	2	ดรุณี	\N	รักษ์ไทย	2	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	3004	2563	105	3	2.23	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	1-6294-31573-24-5	\N	1	นพรัตน์	\N	ยิ้มแย้ม	1	1	0	0	1	ถนนห้วยแก้ว	\N	\N	3004	2559	113	2	3.97	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	7-3684-88010-19-5	\N	1	สิรภพ	\N	ลือชา	1	1	0	0	6	ถ.บ้านโป่ง	\N	\N	3002	2559	113	1	3.25	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	5	10010006	6-2881-89494-81-2	\N	3	นลินทิพย์	\N	เจริญชัย	2	1	0	0	8	ถนนนิมมานเหมินท์	\N	\N	3001	2564	104	3	3.55	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	6-9584-69034-48-9	\N	2	สุมาลี	\N	เจริญชัย	2	1	0	0	10	ถนนมิตรภาพ	\N	\N	3004	2558	421	1	3.23	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	5-5324-88764-59-2	\N	2	ลลิตา	\N	พงษ์ไพร	2	1	0	0	7	ถนนสุรวงศ์	\N	\N	3001	2563	105	3	2.51	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010006	4-8185-93913-30-2	\N	3	ธัญชนก	\N	ลือชา	2	1	0	0	3	ถนนสีลม	\N	\N	3003	2559	113	2	2.97	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	2-9983-83765-76-8	\N	3	วาสนา	\N	มีสุข	2	1	0	0	6	ถนนกลางเมือง	\N	\N	3003	2560	112	1	3.57	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	1-1978-52426-85-1	\N	2	มาลัย	\N	บุญมี	2	1	0	0	6	ถนนวิภาวดีรังสิต	\N	\N	3002	2562	106	1	3.28	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	5-1531-52273-82-2	\N	2	วันวิสา	\N	มีสุข	2	1	0	0	10	ถนนสีลม	\N	\N	3002	2564	104	2	3.19	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	2	10010006	8-2689-27659-34-4	\N	2	สุดารัตน์	\N	พันธุ์ดี	2	1	0	0	4	ถนนรัตนาธิเบศร์	\N	\N	3004	2558	421	3	3.48	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	8-6140-86718-95-9	\N	2	เกวลิน	\N	ดีสมัย	2	1	0	0	1	ถนนสุดสาคร	\N	\N	3003	2567	101	3	3.05	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	8-9008-92471-51-8	\N	1	ธนพัฒน์	\N	สมบูรณ์	1	1	0	0	9	ถนนประดิษฐ์มนูธรรม	\N	\N	3001	2560	112	2	3.83	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	7-5055-16213-85-8	\N	1	ชูเกียรติ	\N	สุดสวย	1	1	0	0	8	ถนนสีลม	\N	\N	3004	2559	113	2	3.7	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	8-9245-52716-52-1	\N	1	ภัคพล	\N	มงคล	1	1	0	0	1	ถนนวิภาวดีรังสิต	\N	\N	3004	2567	103	1	3.22	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	1-2338-12256-66-4	\N	2	ทิพย์สุดา	\N	มีสุข	2	1	0	0	3	ถนนชัยพฤกษ์	\N	\N	3002	2558	421	2	2.31	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	2	10010006	4-1257-53590-89-5	\N	2	มณีรัตน์	\N	มีสุข	2	1	0	0	2	ถนนมิตรภาพ	\N	\N	3005	2556	423	2	2.58	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	4	10010006	8-3696-46432-91-6	\N	2	ศิริพร	\N	ใจดี	2	1	0	0	9	ถนนบรมราชชนนี	\N	\N	3004	2559	113	2	2.41	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	6-4284-82170-10-6	\N	2	รุ่งอรุณ	\N	วิริยะ	2	1	0	0	4	ถนนสุดสาคร	\N	\N	3005	2561	111	1	3.09	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	6-1544-69433-99-1	\N	3	เพ็ญพักตร์	\N	รักษ์ไทย	2	1	0	0	6	ถนนบรมราชชนนี	\N	\N	3004	2556	423	1	3.74	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	3-9761-23992-50-7	\N	1	กิตติภณ	\N	รุ่งเรือง	1	1	0	0	9	ถนนสุรวงศ์	\N	\N	3005	2556	423	2	2.36	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	3-2829-47851-83-3	\N	2	ณัฐนิชา	\N	ลือชา	2	1	0	0	5	ถนนบรมราชชนนี	\N	\N	3005	2564	104	1	3.01	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	7-4149-84233-14-9	\N	1	สุรชัย	\N	จันทร์แก้ว	1	1	0	0	6	ถนนเจริญกรุง	\N	\N	3004	2558	421	1	3.74	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	4-7964-77618-25-7	\N	1	กิตติภณ	\N	รุ่งเรือง	1	1	0	0	8	ถนนราษฎร์บูรณะ	\N	\N	3005	2566	102	3	3.88	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	7-8779-73012-57-6	\N	1	ปิยังกูร	\N	ประสิทธิ์ผล	1	1	0	0	10	ถนนมิตรภาพ	\N	\N	3004	2566	102	3	3.12	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	8-8887-96368-26-6	\N	3	นลินทิพย์	\N	พันธุ์ดี	2	1	0	0	1	ถนนวิภาวดีรังสิต	\N	\N	3001	2556	423	2	3.89	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	5	10010006	2-1422-92337-79-6	\N	1	ธนาธิป	\N	ชัยมงคล	1	1	0	0	6	ถนนเจริญกรุง	\N	\N	3005	2567	103	3	3.1	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	5	10010006	8-3440-16090-77-1	\N	2	นันทพร	\N	ชัยมงคล	2	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	3004	2564	104	2	3.56	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	8-5963-86002-41-2	\N	1	ภูมิพัฒน์	\N	ธนาคาร	1	1	0	0	7	ถนนบายพาส	\N	\N	3003	2563	105	2	2.12	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	2-6624-93258-56-7	\N	1	คุณากร	\N	เพียรดี	1	1	0	0	7	ถนนบรมราชชนนี	\N	\N	3001	2562	106	3	3.64	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	6-1737-15517-15-5	\N	1	ชัยชนะ	\N	พันธุ์ดี	1	1	0	0	6	ถนนประดิษฐ์มนูธรรม	\N	\N	3001	2560	112	2	3.33	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	1-7298-50654-87-5	\N	2	ปัณฑิตา	\N	บุญมี	2	1	0	0	10	ถนนสุรวงศ์	\N	\N	3004	2557	422	2	3.75	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	7-4459-83717-37-7	\N	3	อัมพร	\N	ทั่วถึง	2	1	0	0	5	ถ.บ้านโป่ง	\N	\N	3005	2567	103	3	2.61	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	2-8938-15030-77-4	\N	1	ดิศรณ์	\N	ขาวสะอาด	1	1	0	0	4	ถนนมิตรภาพ	\N	\N	3003	2557	422	3	3.83	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	7-7576-42477-95-1	\N	1	ทัศนัย	\N	สง่างาม	1	1	0	0	1	ถนนลาดพร้าว	\N	\N	3003	2567	103	2	2.69	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	1	10010006	7-9123-92833-31-6	\N	2	มณีรัตน์	\N	ชูศรี	2	1	0	0	2	ถนนนิมมานเหมินท์	\N	\N	3005	2559	113	2	3.4	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	1	10010006	8-4453-19635-73-1	\N	1	ณัฐวรรธน์	\N	ดำรงค์	1	1	0	0	10	ถนนโชคชัย	\N	\N	3004	2560	112	3	2.88	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	1-4765-92143-79-5	\N	1	ธัชพล	\N	รุ่งเรือง	1	1	0	0	7	ถนนเพชรเกษม	\N	\N	3005	2561	111	1	2.6	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	1	10010006	6-5278-63589-59-3	\N	1	นพรัตน์	\N	จันทร์แก้ว	1	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	3003	2566	102	1	3.07	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	8-7593-87791-74-8	\N	1	รัฐนนท์	\N	รักษ์ไทย	1	1	0	0	7	ถนนศรีนครินทร์	\N	\N	3003	2562	106	2	2.22	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	5-9000-46712-56-1	\N	1	ทัศนัย	\N	ชูศรี	1	1	0	0	9	ถนนรัตนาธิเบศร์	\N	\N	3003	2556	423	3	3.28	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	1	10010006	2-7951-14826-45-3	\N	3	สุภัสสรา	\N	อินทร์ชัย	2	1	0	0	7	ถนนบรมราชชนนี	\N	\N	3002	2561	111	2	3.59	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	5-2716-58493-33-7	\N	3	ปาณิสรา	\N	วงษ์สุวรรณ	2	1	0	0	5	ถนนวิภาวดีรังสิต	\N	\N	3004	2556	423	1	3.7	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	6-5209-21312-94-2	\N	2	แสงดาว	\N	คงพิทักษ์	2	1	0	0	4	ถ.รัฐพัฒนา	\N	\N	3004	2567	103	2	3.51	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	4-9971-35209-66-4	\N	1	สิรภพ	\N	คงพิทักษ์	1	1	0	0	10	ถนนสุดสาคร	\N	\N	3005	2556	423	2	2.27	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	4	10010006	8-5609-96493-96-2	\N	2	วันวิสา	\N	ขาวสะอาด	2	1	0	0	5	ถนนอุดรดุษฎี	\N	\N	3002	2561	111	3	2.95	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	6-4133-47016-29-6	\N	3	ประภา	\N	สุขสบาย	2	1	0	0	6	ถนนช้างเผือก	\N	\N	3002	2564	104	3	2.42	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	2	10010006	5-3013-57197-54-2	\N	2	กัญญาณัฐ	\N	รักษ์ไทย	2	1	0	0	1	ถนนมิตรภาพ	\N	\N	3004	2567	101	1	2.81	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	7-9866-75970-91-1	\N	3	อรณิชา	\N	สง่างาม	2	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	3002	2567	101	2	2.51	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	2	10010006	7-4082-36938-49-1	\N	1	อนุชา	\N	สุขสบาย	1	1	0	0	3	ถนนสาทร	\N	\N	3004	2567	103	2	2.33	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	8-5054-41960-29-7	\N	2	ปิยนุช	\N	สีดา	2	1	0	0	3	ถ.ประชาสามัคคี	\N	\N	3002	2559	113	2	2.94	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	2-5798-60436-78-8	\N	3	สุมาลี	\N	มีสุข	2	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	3003	2558	421	3	2.67	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	2-4297-64667-72-6	\N	1	สุทธิพงษ์	\N	พันธุ์ดี	1	1	0	0	8	ถนนราษฎร์บูรณะ	\N	\N	3003	2562	106	3	2.39	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	1	10010006	7-7925-67558-92-9	\N	3	สุนิสา	\N	วังขวา	2	1	0	0	4	ถนนศรีนครินทร์	\N	\N	3005	2557	422	3	2.66	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	1	10010006	4-2758-73394-67-1	\N	1	ชินดนัย	\N	ใจดี	1	1	0	0	6	ถนนสุรวงศ์	\N	\N	3004	2567	101	3	3.57	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	6-2570-77120-12-2	\N	2	ปัณฑิตา	\N	ศักดิ์สิทธิ์	2	1	0	0	7	ถนนสุดสาคร	\N	\N	3005	2557	422	1	2.4	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	4	10010006	2-4638-75632-77-6	\N	2	บุษยา	\N	เพ็งพา	2	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	3002	2567	103	1	3.17	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	5	10010006	2-6889-73528-41-5	\N	1	สมชาย	\N	นามมนตรี	1	1	0	0	2	ถนนห้วยแก้ว	\N	\N	3002	2566	102	2	3.32	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	3-4861-59814-55-1	\N	1	ภูมิพัฒน์	\N	สุจริต	1	1	0	0	5	ถนนสุดสาคร	\N	\N	3004	2562	106	1	3	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	2	10010006	8-3159-28953-53-2	\N	1	อภิวัฒน์	\N	รุ่งเรือง	1	1	0	0	9	ถนนชัยพฤกษ์	\N	\N	3002	2556	423	2	3.73	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	3	10010006	3-2065-17909-77-5	\N	2	นวลจันทร์	\N	ธนาคาร	2	1	0	0	1	ถนนงามวงศ์วาน	\N	\N	3002	2567	103	1	3.92	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	2-1608-83968-88-8	\N	3	กาญจนา	\N	อ่อนน้อม	2	1	0	0	6	ถนนศรีนครินทร์	\N	\N	3001	2556	423	1	3.42	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	2-7411-83027-96-3	\N	3	ปิยนุช	\N	รุ่งเรือง	2	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	3003	2562	106	3	2.43	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	8-2355-46775-35-1	\N	1	กวินท์	\N	อินทร์ชัย	1	1	0	0	4	ถนนพหลโยธิน	\N	\N	3004	2561	111	1	3.15	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	4	10010006	1-8903-10953-90-3	\N	1	ภูมิพัฒน์	\N	แสงสว่าง	1	1	0	0	5	ถ.บ้านโป่ง	\N	\N	3003	2567	103	1	2.92	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	3-2034-40282-31-8	\N	3	วาสนา	\N	อ่อนน้อม	2	1	0	0	4	ถนนนวมินทร์	\N	\N	3004	2557	422	3	3.43	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	8-3861-52988-42-1	\N	1	ชาตรี	\N	สมบูรณ์	1	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	3002	2556	423	1	2.35	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	2-9288-80386-61-5	\N	1	นพรัตน์	\N	สุจริต	1	1	0	0	6	ถนนกาญจนาภิเษก	\N	\N	3003	2567	103	2	2.72	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	5-8020-38401-61-7	\N	2	บุษยา	\N	แสงสว่าง	2	1	0	0	10	ถนนเจริญกรุง	\N	\N	3004	2557	422	1	3.47	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	3	10010006	1-5589-54064-79-4	\N	1	สุรชัย	\N	สุขสันต์	1	1	0	0	9	ถ.บ้านโป่ง	\N	\N	3003	2560	112	3	3.3	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	1-4084-25147-66-3	\N	2	ปัณฑิตา	\N	ทั่วถึง	2	1	0	0	2	ถนนงามวงศ์วาน	\N	\N	3004	2564	104	1	3.31	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	4-4874-24416-57-7	\N	1	ชูเกียรติ	\N	เกียรติสกุล	1	1	0	0	10	ถนนมาลัยแมน	\N	\N	3005	2567	101	1	2.92	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	3	10010006	4-4420-52844-33-1	\N	2	ณัฐนิชา	\N	แสงสว่าง	2	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	3001	2567	103	2	2.26	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	2	10010006	5-3137-60636-61-4	\N	1	วีรชัย	\N	แสงสว่าง	1	1	0	0	4	ถนนรามคำแหง	\N	\N	3005	2559	113	1	3.98	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	2-8788-21234-98-8	\N	3	ภัทรวดี	\N	แสงสว่าง	2	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	3005	2567	103	1	2.39	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	1	10010006	6-1472-82624-19-1	\N	3	พรรษา	\N	ทองดี	2	1	0	0	1	ถนนช้างเผือก	\N	\N	3003	2567	103	3	3.4	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	2	10010006	6-7047-21406-70-7	\N	2	ลลิตา	\N	ยิ้มแย้ม	2	1	0	0	4	ถนนกลางเมือง	\N	\N	3003	2567	101	2	4	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	1	10010006	7-8846-22820-16-7	\N	1	สิรภพ	\N	ศรีสุข	1	1	0	0	7	ถนนห้วยแก้ว	\N	\N	3002	2557	422	1	3.41	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	2	10010006	8-8213-68169-46-2	\N	2	ณัฐนิชา	\N	พันธุ์ดี	2	1	0	0	5	ถนนลาดพร้าว	\N	\N	3005	2558	421	1	2.73	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	8-9080-98826-54-3	\N	2	กาญจนา	\N	กิตติคุณ	2	1	0	0	7	ถนนรามคำแหง	\N	\N	3003	2567	103	1	2.43	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	2-7570-82592-41-2	\N	3	ปิยนุช	\N	พรประเสริฐ	2	1	0	0	8	ถนนเพชรเกษม	\N	\N	3005	2561	111	3	3.65	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	2	10010006	3-5796-75634-49-6	\N	2	สุภัสสรา	\N	ใจดี	2	1	0	0	5	ถนนมาลัยแมน	\N	\N	3003	2561	111	3	2.67	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	8-5320-22112-83-1	\N	2	สิริมา	\N	สุจริต	2	1	0	0	7	ถนนสุดสาคร	\N	\N	3002	2566	102	1	3.88	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	5	10010006	1-4146-43314-10-2	\N	3	สุดารัตน์	\N	อ่อนน้อม	2	1	0	0	2	ถ.บ้านโป่ง	\N	\N	3001	2566	102	2	3.21	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	1	10010006	1-2857-23569-96-3	\N	3	กัญญาณัฐ	\N	มณีรัตน์	2	1	0	0	8	ถนนสาทร	\N	\N	3004	2562	106	1	3.3	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	4-6208-71620-85-7	\N	1	ศุภณัฐ	\N	เพียรดี	1	1	0	0	6	ถนนอุดรดุษฎี	\N	\N	3005	2567	101	2	2.74	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	1	10010006	6-5763-27023-61-1	\N	2	พิมพ์ชนก	\N	ใจดี	2	1	0	0	8	ถนนประดิษฐ์มนูธรรม	\N	\N	3005	2567	103	3	3.59	10	นครราชสีมา	เมืองนครราชสีมา	มะเริง
2569	1	4	10010006	3-5963-96611-18-2	\N	1	ศิวกร	\N	ใจดี	1	1	0	0	5	ถ.เอกชัย	\N	\N	3001	2564	104	2	2.57	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	3	10010006	4-2023-94439-64-5	\N	3	วิมลรัตน์	\N	สกุลดี	2	1	0	0	3	ถนนงามวงศ์วาน	\N	\N	3002	2558	421	3	2.29	10	นครราชสีมา	เมืองนครราชสีมา	โพธิ์กลาง
2569	1	4	10010006	6-2602-92301-99-6	\N	1	ภัคพล	\N	วิริยะ	1	1	0	0	10	ถนนชัยพฤกษ์	\N	\N	3003	2563	105	1	2.45	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	8-5696-65664-42-6	\N	1	กันตภณ	\N	สุดสวย	1	1	0	0	4	ถนนสีลม	\N	\N	3004	2558	421	2	2.29	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	5	10010006	1-6301-94616-46-2	\N	1	ภัคพล	\N	งามดี	1	1	0	0	2	ถนนสาทร	\N	\N	3003	2561	111	2	2.22	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	4-2723-99600-11-8	\N	2	นวลจันทร์	\N	อินทร์ชัย	2	1	0	0	9	ถนนลาดพร้าว	\N	\N	3003	2561	111	3	3.79	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	2-9632-39808-11-5	\N	3	บุษยา	\N	ดำรงค์	2	1	0	0	2	ถนนห้วยแก้ว	\N	\N	3003	2563	105	3	2.75	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	4	10010006	4-7080-95772-93-8	\N	3	สมหญิง	\N	กิตติคุณ	2	1	0	0	4	ถนนอุดรดุษฎี	\N	\N	3003	2557	422	1	2.48	10	นครราชสีมา	เมืองนครราชสีมา	หนองจะบก
2569	1	5	10010006	6-4955-20027-95-8	\N	2	ปัณฑิตา	\N	เพียรดี	2	1	0	0	6	ถนนรัตนาธิเบศร์	\N	\N	3004	2556	423	2	2.31	10	นครราชสีมา	เมืองนครราชสีมา	โคกสูง
2569	1	1	10010006	6-7518-83008-83-8	\N	2	พิมพ์ชนก	\N	ลือชา	2	1	0	0	5	ถนนสุขุมวิท	\N	\N	3001	2566	102	3	2.67	10	นครราชสีมา	เมืองนครราชสีมา	ในเมือง
2569	1	4	10010007	5-1157-83921-32-1	\N	3	กัญญาณัฐ	\N	สุดสวย	2	1	0	0	2	ถนนสุดสาคร	\N	\N	5703	2561	111	2	3.64	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	2-5967-14360-54-9	\N	2	ชนิดา	\N	ทองดี	2	1	0	0	1	ถนนบายพาส	\N	\N	5701	2567	101	1	3.83	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	3	10010007	5-1091-16425-11-1	\N	2	ณัฐนิชา	\N	สุขสันต์	2	1	0	0	5	ถนนลาดพร้าว	\N	\N	5703	2563	105	2	2.72	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	8-7308-79261-37-5	\N	1	ศิวกร	\N	วังขวา	1	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	5704	2559	113	2	2.5	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	3-5620-61945-64-3	\N	3	รัตนาภรณ์	\N	รุ่งเรือง	2	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	5701	2556	423	3	3.16	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	6-2296-21688-74-2	\N	2	วรรณภา	\N	ดีสมัย	2	1	0	0	3	ถนนเพชรเกษม	\N	\N	5705	2561	111	3	3.05	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	6-6405-88861-12-5	\N	2	มณีรัตน์	\N	สุจริต	2	1	0	0	4	ถนนเพชรเกษม	\N	\N	5703	2567	103	3	3.42	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	4	10010007	7-5497-73049-71-7	\N	3	ณัฐนิชา	\N	สุขสันต์	2	1	0	0	4	ถนนเพชรเกษม	\N	\N	5701	2564	104	2	2.33	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	7-8730-17590-30-6	\N	1	อนุชา	\N	อินทร์ชัย	1	1	0	0	5	ถนนบายพาส	\N	\N	5702	2567	101	1	3.38	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	7-5634-57903-92-9	\N	1	รชานนท์	\N	วิริยะ	1	1	0	0	10	ถนนศรีนครินทร์	\N	\N	5703	2563	105	2	2.76	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	2	10010007	2-2442-41729-66-3	\N	3	แสงดาว	\N	วงษ์สุวรรณ	2	1	0	0	5	ถนนกาญจนาภิเษก	\N	\N	5705	2556	423	1	3.02	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	2-5360-49234-77-5	\N	2	จันทร์เพ็ญ	\N	สง่างาม	2	1	0	0	1	ถนนพหลโยธิน	\N	\N	5705	2564	104	3	3.49	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	3	10010007	3-5738-83446-74-8	\N	3	นภาพร	\N	มงคล	2	1	0	0	9	ถนนสุขุมวิท	\N	\N	5705	2567	103	2	2.62	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	8-4371-69344-77-1	\N	2	ประภา	\N	ลือชา	2	1	0	0	6	ถนนสุรวงศ์	\N	\N	5704	2567	101	2	3.7	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	7-3077-80546-83-8	\N	3	นันทพร	\N	ศรีสุข	2	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	5705	2558	421	3	2.91	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	2-4108-57812-30-7	\N	3	พรรษา	\N	สกุลดี	2	1	0	0	5	ถนนสรงประภา	\N	\N	5704	2561	111	3	3.3	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	1-9699-56535-63-8	\N	2	ดรุณี	\N	ศรีสุข	2	1	0	0	6	ถนนรามคำแหง	\N	\N	5704	2558	421	3	2.99	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	2	10010007	7-8945-16082-94-5	\N	1	วสันต์	\N	เกียรติสกุล	1	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	5704	2559	113	3	3.18	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	8-1907-27664-56-1	\N	2	กาญจนา	\N	นามมนตรี	2	1	0	0	2	ถนนกลางเมือง	\N	\N	5701	2557	422	2	3.69	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	6-8508-52437-26-6	\N	3	วิมลรัตน์	\N	นิ่มนวล	2	1	0	0	7	ถนนสาทร	\N	\N	5703	2558	421	3	3.66	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	6-8756-61167-96-7	\N	3	ปาณิสรา	\N	ทั่วถึง	2	1	0	0	4	ถนนสุรวงศ์	\N	\N	5705	2566	102	2	3	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	3	10010007	6-4535-11292-97-8	\N	3	ดวงใจ	\N	สมบูรณ์	2	1	0	0	3	ถ.เอกชัย	\N	\N	5701	2566	102	1	4	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	8-1986-82787-84-5	\N	2	อรณิชา	\N	ลือชา	2	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	5704	2559	113	2	3.34	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	3-8613-67039-97-5	\N	2	ณัฐนิชา	\N	รุ่งเรือง	2	1	0	0	5	ถนนนวมินทร์	\N	\N	5704	2559	113	3	2.06	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	1-1927-73169-87-7	\N	1	ชัยชนะ	\N	สง่างาม	1	1	0	0	2	ถนนอุดรดุษฎี	\N	\N	5705	2557	422	1	3.38	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	8-2739-65060-46-2	\N	3	พรทิพย์	\N	กิตติคุณ	2	1	0	0	10	ถนนรามคำแหง	\N	\N	5704	2560	112	2	2.28	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	3-6621-89611-32-6	\N	3	กุลธิดา	\N	ชูศรี	2	1	0	0	1	ถนนเพชรเกษม	\N	\N	5703	2560	112	3	2.94	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	8-9349-28602-36-1	\N	2	จิตรลดา	\N	สุวรรณภูมิ	2	1	0	0	8	ถนนลาดพร้าว	\N	\N	5704	2563	105	2	3.06	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	2	10010007	1-3317-37328-71-5	\N	1	คุณากร	\N	ใจดี	1	1	0	0	4	ถนนศรีนครินทร์	\N	\N	5702	2564	104	3	2.75	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	1-2479-59720-96-6	\N	2	ดรุณี	\N	งามดี	2	1	0	0	10	ถนนรามคำแหง	\N	\N	5703	2556	423	2	2.2	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	5-1645-42411-18-2	\N	1	ชัยชนะ	\N	สุดสวย	1	1	0	0	9	ถนนชัยพฤกษ์	\N	\N	5702	2561	111	2	2.96	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	2-3377-13603-34-4	\N	2	จิตรลดา	\N	หอมหวาน	2	1	0	0	10	ถนนรัตนาธิเบศร์	\N	\N	5704	2559	113	3	2.7	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	5-4094-83088-96-4	\N	3	จิตรลดา	\N	สกุลดี	2	1	0	0	8	ถนนมิตรภาพ	\N	\N	5704	2564	104	2	2.48	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	5-6316-17039-41-1	\N	3	รัตนาภรณ์	\N	เจริญชัย	2	1	0	0	3	ถ.ประชาสามัคคี	\N	\N	5702	2564	104	3	3.06	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	6-1763-53254-55-4	\N	2	อรณิชา	\N	บริบูรณ์	2	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	5705	2567	103	1	2.92	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	3-7464-83184-69-8	\N	2	เพ็ญพักตร์	\N	นามมนตรี	2	1	0	0	10	ถนนสุรวงศ์	\N	\N	5703	2567	103	1	3.44	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	8-8866-43700-73-9	\N	2	จิตรลดา	\N	พรสวรรค์	2	1	0	0	7	ถนนบรมราชชนนี	\N	\N	5702	2561	111	2	3	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	4	10010007	3-7179-91320-58-6	\N	1	ศิวกร	\N	มณีรัตน์	1	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	5704	2556	423	3	3.74	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	2	10010007	1-3305-12392-46-1	\N	1	เอกพงษ์	\N	วิไลวรรณ	1	1	0	0	5	ถนนงามวงศ์วาน	\N	\N	5704	2567	101	1	3.5	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	5-5085-42570-68-1	\N	1	เจษฎา	\N	พรสวรรค์	1	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	5701	2566	102	1	2.7	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	6-1490-20347-84-4	\N	2	ลลิตา	\N	พันธุ์ดี	2	1	0	0	6	ถนนสาทร	\N	\N	5705	2563	105	1	3.6	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	5-7051-61860-66-4	\N	1	บุญยิ่ง	\N	วงษ์สุวรรณ	1	1	0	0	2	ถนนสีลม	\N	\N	5701	2564	104	3	2.78	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	2-8389-57115-63-1	\N	2	วรรณภา	\N	สีดา	2	1	0	0	8	ถนนสีลม	\N	\N	5701	2562	106	2	3.13	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	8-1725-20934-10-2	\N	1	ธนาธิป	\N	จันทร์แก้ว	1	1	0	0	5	ถนนราษฎร์บูรณะ	\N	\N	5704	2559	113	2	2.43	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	3-5277-12038-10-7	\N	2	รัตนาภรณ์	\N	ปัญญาดี	2	1	0	0	2	ถนนสาทร	\N	\N	5705	2556	423	1	3.84	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	6-2392-45500-41-6	\N	3	เกวลิน	\N	มงคล	2	1	0	0	9	ถนนลาดพร้าว	\N	\N	5705	2563	105	2	2.11	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	6-1861-20866-50-4	\N	2	กาญจนา	\N	ใจดี	2	1	0	0	2	ถนนรามคำแหง	\N	\N	5705	2563	105	1	3.91	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	4-5489-74801-72-7	\N	3	เพ็ญพักตร์	\N	แสงสว่าง	2	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	5702	2560	112	2	3.2	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	5-3771-33522-49-7	\N	3	ปาณิสรา	\N	เจริญชัย	2	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	5702	2561	111	2	2.83	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	4	10010007	8-6529-43797-23-9	\N	3	มาลัย	\N	เพียรดี	2	1	0	0	3	ถ.บ้านโป่ง	\N	\N	5705	2567	103	1	3.6	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	6-1345-19914-82-8	\N	2	ภัทรวดี	\N	ขาวสะอาด	2	1	0	0	6	ถนนมิตรภาพ	\N	\N	5705	2561	111	1	2.89	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	6-1764-44426-44-5	\N	2	ปัณฑิตา	\N	ประสิทธิ์ผล	2	1	0	0	2	ถนนนิมมานเหมินท์	\N	\N	5704	2558	421	2	3.7	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	2	10010007	1-9684-80623-17-6	\N	2	วันวิสา	\N	นิ่มนวล	2	1	0	0	1	ถนนงามวงศ์วาน	\N	\N	5703	2562	106	3	2.81	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	4	10010007	5-8278-15636-47-3	\N	2	สุภัสสรา	\N	มีสุข	2	1	0	0	5	ถนนงามวงศ์วาน	\N	\N	5705	2566	102	1	3.12	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	2-8194-95639-11-1	\N	2	สุมาลี	\N	พันธุ์ดี	2	1	0	0	7	ถนนนวมินทร์	\N	\N	5702	2563	105	2	3.95	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	4-8659-61306-62-2	\N	1	สิรภพ	\N	อินทร์ชัย	1	1	0	0	1	ถนนห้วยแก้ว	\N	\N	5704	2559	113	3	2.94	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	8-8084-11822-20-8	\N	3	สุภัสสรา	\N	ธนาคาร	2	1	0	0	6	ถนนรามคำแหง	\N	\N	5701	2566	102	1	2.54	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	5-7024-57525-68-7	\N	1	ธนภัทร	\N	มีสุข	1	1	0	0	2	ถนนเจริญกรุง	\N	\N	5704	2557	422	2	2.36	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	2-3610-33183-80-4	\N	3	กาญจนา	\N	พรสวรรค์	2	1	0	0	5	ถนนรามคำแหง	\N	\N	5701	2562	106	2	2.98	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	8-3895-57650-89-8	\N	2	สิริมา	\N	ยิ้มแย้ม	2	1	0	0	9	ถนนสีลม	\N	\N	5705	2563	105	1	2.72	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	3	10010007	2-3794-15890-54-5	\N	1	ภัคพล	\N	สุขสันต์	1	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	5704	2567	103	3	2.3	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	2	10010007	3-1996-79745-37-7	\N	2	มาลัย	\N	วงษ์สุวรรณ	2	1	0	0	2	ถนนพหลโยธิน	\N	\N	5702	2557	422	2	3.51	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	1	10010007	3-1774-95691-60-4	\N	1	อภิวัฒน์	\N	สุวรรณภูมิ	1	1	0	0	8	ถนนรัตนาธิเบศร์	\N	\N	5704	2559	113	1	3.7	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	2-7413-67424-58-2	\N	1	ประพันธ์	\N	ชัยมงคล	1	1	0	0	7	ถนนมาลัยแมน	\N	\N	5705	2560	112	3	2.21	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	4-7320-17123-26-6	\N	1	สุทธิพงษ์	\N	ประสิทธิ์ผล	1	1	0	0	4	ถนนบายพาส	\N	\N	5703	2567	101	2	3.89	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	5-6891-16029-80-1	\N	2	กุลธิดา	\N	พรสวรรค์	2	1	0	0	7	ถนนกาญจนาภิเษก	\N	\N	5701	2562	106	1	2.36	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	8-2587-80230-35-5	\N	1	ทักษิณ	\N	มีสุข	1	1	0	0	2	ถนนรัตนาธิเบศร์	\N	\N	5705	2567	103	1	3.68	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	5-4946-83867-39-1	\N	1	วสันต์	\N	สุขสบาย	1	1	0	0	1	ถนนกาญจนาภิเษก	\N	\N	5704	2567	103	2	3.17	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	8-1625-60307-45-4	\N	2	วรรณภา	\N	สุดสวย	2	1	0	0	8	ถนนกลางเมือง	\N	\N	5703	2559	113	1	3.42	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	6-4974-17560-43-8	\N	1	ศิวกร	\N	พันธุ์ดี	1	1	0	0	1	ถนนสรงประภา	\N	\N	5704	2564	104	1	3.34	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	4-1071-99866-16-6	\N	2	นวลจันทร์	\N	เพ็งพา	2	1	0	0	1	ถนนรามคำแหง	\N	\N	5704	2556	423	2	2.74	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	2	10010007	1-9879-47060-33-8	\N	3	ศิริพร	\N	ขาวสะอาด	2	1	0	0	5	ถนนสุขุมวิท	\N	\N	5704	2558	421	3	3.02	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	6-4665-34088-11-6	\N	2	รัตนาภรณ์	\N	วิริยะ	2	1	0	0	3	ถนนนวมินทร์	\N	\N	5703	2566	102	2	2.75	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	3-5143-71356-20-2	\N	3	ชลธิชา	\N	สุขสันต์	2	1	0	0	8	ถนนประดิษฐ์มนูธรรม	\N	\N	5703	2561	111	1	2.54	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	2-9693-93244-44-2	\N	3	แสงดาว	\N	สุขสบาย	2	1	0	0	9	ถนนสุขุมวิท	\N	\N	5703	2566	102	1	3.98	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	1-9070-43854-90-1	\N	2	วันวิสา	\N	ปัญญาดี	2	1	0	0	5	ถนนกลางเมือง	\N	\N	5703	2562	106	1	2.04	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	3-8746-63368-99-3	\N	1	ชาตรี	\N	สกุลดี	1	1	0	0	7	ถนนประดิษฐ์มนูธรรม	\N	\N	5705	2560	112	1	2.43	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	3-7056-33352-36-1	\N	2	ลลิตา	\N	วิริยะ	2	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	5704	2561	111	1	2.28	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	2-4335-72545-36-5	\N	2	สุนิสา	\N	รุ่งเรือง	2	1	0	0	10	ถนนบรมราชชนนี	\N	\N	5701	2563	105	1	2.3	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	7-7379-85838-46-4	\N	1	ชัยชนะ	\N	วิไลวรรณ	1	1	0	0	7	ถนนนิมมานเหมินท์	\N	\N	5705	2557	422	3	2.44	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	6-5586-58867-63-9	\N	1	ภัคพล	\N	สุวรรณภูมิ	1	1	0	0	2	ถนนกลางเมือง	\N	\N	5702	2558	421	3	2.61	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	7-4812-95601-23-9	\N	1	ทัศนัย	\N	บุญรอด	1	1	0	0	8	ถนนประดิษฐ์มนูธรรม	\N	\N	5705	2561	111	1	3.85	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	3-4443-41545-38-9	\N	2	สุนิสา	\N	พงษ์ไพร	2	1	0	0	9	ถนนสุรวงศ์	\N	\N	5701	2566	102	1	2.51	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	3-9120-12117-43-1	\N	1	บุญยิ่ง	\N	ดำรงค์	1	1	0	0	1	ถนนนิมมานเหมินท์	\N	\N	5704	2567	103	1	2.78	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	5-8656-15256-73-3	\N	1	ชูเกียรติ	\N	สุขสันต์	1	1	0	0	7	ถนนลาดพร้าว	\N	\N	5705	2567	103	2	2.97	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	7-4318-64175-74-1	\N	1	เจษฎา	\N	วิไลวรรณ	1	1	0	0	6	ถนนสาทร	\N	\N	5704	2567	101	3	3.13	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	1-8543-13872-21-9	\N	2	กุลธิดา	\N	สุขสันต์	2	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	5705	2559	113	1	2.4	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	3	10010007	7-3270-23672-10-9	\N	2	ศิริพร	\N	ยิ้มแย้ม	2	1	0	0	7	ถนนอ่อนนุช	\N	\N	5704	2564	104	1	3.14	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	7-1184-11805-58-7	\N	2	พรรษา	\N	วิริยะ	2	1	0	0	9	ถนนเจริญกรุง	\N	\N	5701	2566	102	3	3.92	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	3-7053-32525-79-5	\N	1	ดิศรณ์	\N	กิตติคุณ	1	1	0	0	7	ถนนห้วยแก้ว	\N	\N	5705	2556	423	2	3.45	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	5-2652-97271-88-8	\N	1	ภัคพล	\N	บุญรอด	1	1	0	0	10	ถ.ประชาสามัคคี	\N	\N	5701	2557	422	3	2.27	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	5-1071-90976-79-6	\N	1	นรวิชญ์	\N	ศรีสุข	1	1	0	0	5	ถนนเยาวราช	\N	\N	5701	2562	106	1	3.06	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	7-6215-80672-58-8	\N	2	กัญญา	\N	ปัญญาดี	2	1	0	0	3	ถนนบายพาส	\N	\N	5703	2564	104	1	2.55	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	1-7919-65377-63-5	\N	1	ธนาธิป	\N	จันทร์แก้ว	1	1	0	0	1	ถนนห้วยแก้ว	\N	\N	5702	2567	103	3	3.99	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	1-4467-68344-77-3	\N	3	สมหญิง	\N	อินทร์ชัย	2	1	0	0	6	ถนนสุรวงศ์	\N	\N	5701	2567	101	2	3.59	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	2-6466-51947-72-9	\N	2	ภัทรวดี	\N	รุ่งเรือง	2	1	0	0	2	ถนนสุรวงศ์	\N	\N	5705	2567	101	2	2.53	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	7-3253-45402-71-5	\N	2	กุลธิดา	\N	พันธุ์ดี	2	1	0	0	5	ถนนสุรวงศ์	\N	\N	5702	2558	421	2	3.34	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	1-6764-95102-88-8	\N	1	รัฐนนท์	\N	กิตติคุณ	1	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	5705	2560	112	2	2.45	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	7-5146-11776-24-6	\N	1	กิตติภณ	\N	พรประเสริฐ	1	1	0	0	8	ถ.ประชาสามัคคี	\N	\N	5703	2558	421	2	3.04	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	6-8003-54950-90-3	\N	3	สุนิสา	\N	บุญมี	2	1	0	0	6	ถนนช้างเผือก	\N	\N	5701	2564	104	3	3.46	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	3-1898-70715-30-3	\N	3	นันทพร	\N	ชัยมงคล	2	1	0	0	7	ถ.เอกชัย	\N	\N	5705	2562	106	2	2.91	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	5-2707-39840-76-3	\N	3	ปัณฑิตา	\N	เพียรดี	2	1	0	0	8	ถนนสีลม	\N	\N	5701	2566	102	2	3.98	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	7-3258-30333-55-5	\N	2	รุ่งอรุณ	\N	พงษ์ไพร	2	1	0	0	7	ถนนโชคชัย	\N	\N	5705	2557	422	1	3.67	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	6-9146-45217-92-9	\N	3	ธัญชนก	\N	สกุลดี	2	1	0	0	1	ถนนประดิษฐ์มนูธรรม	\N	\N	5701	2559	113	1	2.72	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	3	10010007	3-8881-40384-90-6	\N	3	กุลธิดา	\N	อ่อนน้อม	2	1	0	0	1	ถนนสุดสาคร	\N	\N	5701	2557	422	3	2.32	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	5-7395-93453-14-7	\N	1	ณัฐพล	\N	สีดา	1	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	5701	2563	105	2	2.83	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	7-7426-56611-95-6	\N	1	สุทธิพงษ์	\N	มงคล	1	1	0	0	5	ถนนช้างเผือก	\N	\N	5701	2566	102	1	3.4	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	5-7555-27077-93-8	\N	2	สุมาลี	\N	ทองดี	2	1	0	0	5	ถนนราษฎร์บูรณะ	\N	\N	5701	2567	103	2	3.79	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	8-4235-17405-73-4	\N	1	ชัยชนะ	\N	วิไลวรรณ	1	1	0	0	3	ถนนเพชรเกษม	\N	\N	5702	2567	103	2	3.4	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	8-1968-92208-78-7	\N	3	จิราพร	\N	ปัญญาดี	2	1	0	0	2	ถนนรามคำแหง	\N	\N	5704	2566	102	1	2.57	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	1-1367-63365-44-3	\N	2	กัญญาณัฐ	\N	เพียรดี	2	1	0	0	3	ถ.รัฐพัฒนา	\N	\N	5703	2557	422	3	2.29	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	3-8062-98303-97-6	\N	2	ปาณิสรา	\N	ขาวสะอาด	2	1	0	0	1	ถนนห้วยแก้ว	\N	\N	5705	2562	106	3	2.83	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	3	10010007	7-1243-30573-75-6	\N	1	ศิวกร	\N	กิตติคุณ	1	1	0	0	10	ถนนมิตรภาพ	\N	\N	5704	2567	103	1	2.35	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	6-9086-51474-82-3	\N	1	สมศักดิ์	\N	สุขสันต์	1	1	0	0	1	ถนนเยาวราช	\N	\N	5705	2561	111	3	3.1	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	3-4742-16518-22-7	\N	1	ณัฐวรรธน์	\N	สุวรรณภูมิ	1	1	0	0	5	ถนนสีลม	\N	\N	5703	2567	101	3	3.61	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	5-5831-94327-46-4	\N	1	บุญยิ่ง	\N	พงษ์ไพร	1	1	0	0	4	ถนนชัยพฤกษ์	\N	\N	5702	2558	421	2	2.92	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	4	10010007	5-1881-48657-70-8	\N	3	มณีรัตน์	\N	พรประเสริฐ	2	1	0	0	3	ถนนเยาวราช	\N	\N	5704	2560	112	3	3.29	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	2	10010007	4-5846-23470-82-1	\N	3	สุมาลี	\N	นิ่มนวล	2	1	0	0	7	ถ.ประชาสามัคคี	\N	\N	5704	2560	112	3	3.61	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	5-3846-90426-75-3	\N	1	ภูมิพัฒน์	\N	ทองดี	1	1	0	0	10	ถนนสุรวงศ์	\N	\N	5705	2561	111	2	3.21	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	3-7941-56595-74-6	\N	1	วีรชัย	\N	ยิ้มแย้ม	1	1	0	0	10	ถ.เอกชัย	\N	\N	5703	2559	113	1	2.26	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	6-6959-71547-82-2	\N	1	ชูเกียรติ	\N	สมบูรณ์	1	1	0	0	6	ถนนเจริญกรุง	\N	\N	5703	2556	423	3	2.14	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	4	10010007	3-4652-47594-36-5	\N	3	พรทิพย์	\N	สุจริต	2	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	5703	2567	103	2	3.93	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	4	10010007	4-6386-89999-93-5	\N	2	ดวงใจ	\N	วิริยะ	2	1	0	0	4	ถนนห้วยแก้ว	\N	\N	5701	2560	112	3	2.43	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	4-3023-30453-76-3	\N	3	บุษยา	\N	มงคล	2	1	0	0	2	ถนนเพชรเกษม	\N	\N	5703	2563	105	1	3.48	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	2	10010007	2-6232-43558-43-8	\N	1	ธนาธิป	\N	ประสิทธิ์ผล	1	1	0	0	9	ถนนโชคชัย	\N	\N	5703	2567	101	1	3.96	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	1-8273-13294-89-6	\N	1	ชูเกียรติ	\N	บริบูรณ์	1	1	0	0	1	ถนนสุดสาคร	\N	\N	5704	2567	101	2	2.59	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	2	10010007	5-4312-27039-64-6	\N	1	วีรชัย	\N	เพียรดี	1	1	0	0	8	ถนนชัยพฤกษ์	\N	\N	5702	2556	423	2	2.81	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	8-1656-73080-75-4	\N	1	ชูเกียรติ	\N	กิตติคุณ	1	1	0	0	8	ถนนเจริญกรุง	\N	\N	5705	2560	112	1	2.51	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	4-7370-84149-23-9	\N	3	ศิริพร	\N	เพ็งพา	2	1	0	0	5	ถนนกลางเมือง	\N	\N	5702	2560	112	3	3.24	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	6-8411-84540-29-9	\N	2	อภิญญา	\N	สุจริต	2	1	0	0	3	ถนนสุดสาคร	\N	\N	5705	2561	111	3	2.6	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	6-2714-51376-87-6	\N	1	เอกพงษ์	\N	คงพิทักษ์	1	1	0	0	3	ถ.เอกชัย	\N	\N	5701	2561	111	2	3.65	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	3	10010007	4-2157-94882-67-4	\N	3	ลลิตา	\N	จันทร์แก้ว	2	1	0	0	2	ถนนสาทร	\N	\N	5703	2561	111	3	2.6	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	8-7217-57287-90-1	\N	3	ศิริพร	\N	เจริญชัย	2	1	0	0	3	ถนนรามคำแหง	\N	\N	5701	2566	102	2	3.62	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	5-6845-78393-95-8	\N	1	ภูมิพัฒน์	\N	ธนาคาร	1	1	0	0	1	ถนนพหลโยธิน	\N	\N	5701	2560	112	2	3.06	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	7-4166-22524-88-1	\N	2	สุภัสสรา	\N	วิไลวรรณ	2	1	0	0	6	ถนนสาทร	\N	\N	5702	2557	422	3	2.11	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	4	10010007	3-9158-47615-96-7	\N	2	นภาพร	\N	เพ็งพา	2	1	0	0	3	ถนนศรีนครินทร์	\N	\N	5705	2563	105	3	3.15	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	6-3679-97599-43-4	\N	3	วาสนา	\N	วิไลวรรณ	2	1	0	0	9	ถ.บ้านโป่ง	\N	\N	5702	2556	423	1	3.49	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	2-6086-95328-48-5	\N	1	บุญยิ่ง	\N	มณีรัตน์	1	1	0	0	10	ถนนกาญจนาภิเษก	\N	\N	5704	2559	113	2	3.21	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	7-3880-92967-43-4	\N	1	มานพ	\N	วังขวา	1	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	5705	2560	112	3	2.54	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	2-6812-69043-39-7	\N	1	สุทธิพงษ์	\N	วังขวา	1	1	0	0	9	ถนนช้างเผือก	\N	\N	5702	2556	423	2	3.88	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	3-6727-21622-92-2	\N	1	ชัยชนะ	\N	มีสุข	1	1	0	0	1	ถนนอ่อนนุช	\N	\N	5701	2567	101	3	2.66	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	8-6818-85897-23-5	\N	1	ชัยชนะ	\N	บุญรอด	1	1	0	0	5	ถนนกลางเมือง	\N	\N	5704	2567	103	1	3.99	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	7-1156-22090-52-1	\N	2	อัมพร	\N	นิ่มนวล	2	1	0	0	5	ถนนสุรวงศ์	\N	\N	5704	2564	104	3	3.03	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	8-7201-49858-69-6	\N	2	พิมพ์ชนก	\N	สุขสบาย	2	1	0	0	7	ถนนสุดสาคร	\N	\N	5702	2567	101	3	3.06	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	5-2369-17688-53-1	\N	3	วันวิสา	\N	ดีสมัย	2	1	0	0	7	ถนนเจริญกรุง	\N	\N	5702	2564	104	3	3.06	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	5-7983-34355-25-5	\N	2	เพ็ญพักตร์	\N	ธนาคาร	2	1	0	0	8	ถนนสุขุมวิท	\N	\N	5702	2561	111	1	2.3	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	1-6275-36717-47-3	\N	3	ภัทรวดี	\N	สุขสันต์	2	1	0	0	9	ถนนพหลโยธิน	\N	\N	5703	2557	422	2	2.44	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	2	10010007	7-2825-56087-17-8	\N	2	จันทร์เพ็ญ	\N	ยิ้มแย้ม	2	1	0	0	2	ถนนรัตนาธิเบศร์	\N	\N	5704	2559	113	3	2.4	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	8-1945-53471-83-1	\N	2	จิราพร	\N	ประสิทธิ์ผล	2	1	0	0	5	ถนนรามคำแหง	\N	\N	5705	2559	113	1	2.87	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	4-2702-87912-83-5	\N	1	เจษฎา	\N	เพียรดี	1	1	0	0	7	ถ.ประชาสามัคคี	\N	\N	5705	2562	106	2	3.22	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	7-2134-29492-29-9	\N	1	สุทธิพงษ์	\N	นิ่มนวล	1	1	0	0	4	ถนนสุขุมวิท	\N	\N	5704	2556	423	3	2.92	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	3-5193-38415-68-6	\N	3	บุษยา	\N	วังขวา	2	1	0	0	10	ถนนสุดสาคร	\N	\N	5704	2556	423	3	3.08	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	4-1200-14686-82-8	\N	3	บุษยา	\N	สมบูรณ์	2	1	0	0	2	ถนนห้วยแก้ว	\N	\N	5704	2561	111	3	2.54	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	4-4540-60416-67-3	\N	3	ศิริพร	\N	ชูศรี	2	1	0	0	2	ถนนงามวงศ์วาน	\N	\N	5703	2563	105	1	3.62	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	3-9760-33922-47-7	\N	3	นภาพร	\N	งามดี	2	1	0	0	5	ถนนรามคำแหง	\N	\N	5705	2558	421	2	2.04	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	3	10010007	3-4549-96594-23-6	\N	1	กวินท์	\N	วงษ์สุวรรณ	1	1	0	0	10	ถนนมาลัยแมน	\N	\N	5704	2567	101	1	3.35	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	2	10010007	2-6973-23920-75-2	\N	1	สุรชัย	\N	บุญรอด	1	1	0	0	4	ถนนบายพาส	\N	\N	5701	2562	106	1	3.76	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	5-5610-88436-43-1	\N	1	ภูมิพัฒน์	\N	นามมนตรี	1	1	0	0	6	ถนนนวมินทร์	\N	\N	5704	2561	111	1	2.75	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	2	10010007	3-9102-83364-82-2	\N	1	ชาตรี	\N	จันทร์แก้ว	1	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	5705	2558	421	3	2.51	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	1-7926-78502-19-5	\N	2	บุษยา	\N	มณีรัตน์	2	1	0	0	5	ถนนบรมราชชนนี	\N	\N	5705	2556	423	2	3.91	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	8-3492-89864-45-3	\N	3	สมหญิง	\N	สีดา	2	1	0	0	1	ถนนมาลัยแมน	\N	\N	5704	2567	103	1	3.06	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	1-5177-91667-92-8	\N	2	วรรณภา	\N	ชัยมงคล	2	1	0	0	8	ถนนห้วยแก้ว	\N	\N	5705	2562	106	3	2.31	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	6-2056-78147-62-2	\N	3	ธัญชนก	\N	สุขสบาย	2	1	0	0	8	ถนนมิตรภาพ	\N	\N	5701	2557	422	1	2.39	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	8-7870-44598-92-2	\N	2	ธัญชนก	\N	สุจริต	2	1	0	0	10	ถนนกาญจนาภิเษก	\N	\N	5703	2559	113	2	3.27	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	2-1164-27863-61-4	\N	2	วาสนา	\N	สมบูรณ์	2	1	0	0	4	ถนนเยาวราช	\N	\N	5703	2567	101	3	3.36	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	4	10010007	5-3710-65396-74-3	\N	1	อภิวัฒน์	\N	มีสุข	1	1	0	0	4	ถนนกลางเมือง	\N	\N	5704	2567	101	1	3.3	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	2-4949-78496-91-1	\N	2	ปาณิสรา	\N	สุดสวย	2	1	0	0	2	ถนนรามคำแหง	\N	\N	5703	2558	421	3	3.58	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	6-2681-37619-89-9	\N	3	นวลจันทร์	\N	ลือชา	2	1	0	0	6	ถนนกลางเมือง	\N	\N	5704	2560	112	2	3.56	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	4-9109-41747-25-8	\N	1	ดิศรณ์	\N	คงมั่น	1	1	0	0	6	ถนนราษฎร์บูรณะ	\N	\N	5704	2561	111	1	3.11	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	2	10010007	2-4350-84571-54-8	\N	2	นันทพร	\N	รักษ์ไทย	2	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	5703	2566	102	2	3.55	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	4	10010007	6-1311-11614-63-5	\N	2	อัมพร	\N	ศักดิ์สิทธิ์	2	1	0	0	6	ถนนห้วยแก้ว	\N	\N	5701	2559	113	1	3.77	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	1-8796-98963-79-3	\N	1	พิพัฒน์	\N	ธนาคาร	1	1	0	0	9	ถนนบายพาส	\N	\N	5705	2559	113	3	3.78	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	4-8402-13053-64-3	\N	1	ประพันธ์	\N	ทั่วถึง	1	1	0	0	6	ถนนโชคชัย	\N	\N	5703	2558	421	2	3.5	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	3-3226-64796-28-4	\N	2	สุมาลี	\N	เจริญชัย	2	1	0	0	2	ถนนมาลัยแมน	\N	\N	5701	2560	112	1	2.73	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	3	10010007	8-1400-38184-48-2	\N	2	ทิพย์สุดา	\N	ใจดี	2	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	5701	2567	101	1	3.78	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	4-8988-21763-40-8	\N	3	เกวลิน	\N	มงคล	2	1	0	0	10	ถนนนวมินทร์	\N	\N	5705	2558	421	3	3.35	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	2-3880-29665-93-4	\N	2	พิมพ์ชนก	\N	พรสวรรค์	2	1	0	0	10	ถนนบายพาส	\N	\N	5703	2566	102	3	2.78	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	4	10010007	5-6442-24912-30-6	\N	3	ลลิตา	\N	มงคล	2	1	0	0	7	ถนนชัยพฤกษ์	\N	\N	5702	2559	113	2	2.54	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	5-5404-27237-85-7	\N	1	อภิวัฒน์	\N	สุขสบาย	1	1	0	0	2	ถนนสาทร	\N	\N	5705	2562	106	2	3.54	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	7-4316-89326-86-5	\N	1	กวินท์	\N	ใจดี	1	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	5705	2560	112	1	3.83	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	3-2156-59955-28-9	\N	1	วีรชัย	\N	เพียรดี	1	1	0	0	7	ถนนพหลโยธิน	\N	\N	5705	2567	101	3	3.58	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	3	10010007	2-1937-42173-63-4	\N	2	ดวงใจ	\N	กิตติคุณ	2	1	0	0	1	ถนนกลางเมือง	\N	\N	5705	2567	103	3	3.09	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	7-5916-19609-27-4	\N	3	จิตรลดา	\N	อ่อนน้อม	2	1	0	0	6	ถนนราษฎร์บูรณะ	\N	\N	5704	2567	103	2	3.33	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	2-2503-10475-68-2	\N	1	ณัฐวรรธน์	\N	ศักดิ์สิทธิ์	1	1	0	0	5	ถนนศรีนครินทร์	\N	\N	5705	2563	105	2	3.53	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	6-9283-47513-43-5	\N	1	สมศักดิ์	\N	ประสิทธิ์ผล	1	1	0	0	4	ถ.บ้านโป่ง	\N	\N	5701	2564	104	2	3.12	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	8-9122-64614-37-9	\N	1	ชูเกียรติ	\N	ศรีสุข	1	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	5702	2563	105	2	3.72	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	5-4943-16115-85-8	\N	1	ณัฐวรรธน์	\N	วิริยะ	1	1	0	0	10	ถ.บ้านโป่ง	\N	\N	5701	2560	112	1	3.02	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	1-2076-78892-70-5	\N	3	นภาพร	\N	สมบูรณ์	2	1	0	0	8	ถนนราษฎร์บูรณะ	\N	\N	5701	2560	112	1	3.11	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	7-6845-91148-98-8	\N	1	สมศักดิ์	\N	สุดสวย	1	1	0	0	5	ถนนบายพาส	\N	\N	5702	2556	423	1	2.32	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	8-9647-24853-67-1	\N	1	นรวิชญ์	\N	แสงสว่าง	1	1	0	0	5	ถนนศรีนครินทร์	\N	\N	5702	2559	113	1	2.27	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	2-9733-51610-88-3	\N	1	ปรเมศวร์	\N	กิตติคุณ	1	1	0	0	1	ถนนมาลัยแมน	\N	\N	5703	2559	113	3	3.1	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	8-3743-61936-21-9	\N	1	ภูมิพัฒน์	\N	มงคล	1	1	0	0	10	ถนนเพชรเกษม	\N	\N	5703	2561	111	2	2.82	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	2-8531-88900-94-3	\N	1	สุทธิพงษ์	\N	สุวรรณภูมิ	1	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	5702	2561	111	1	2.23	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	1-2231-38223-94-8	\N	1	ธัชพล	\N	ยิ้มแย้ม	1	1	0	0	1	ถนนศรีนครินทร์	\N	\N	5702	2562	106	1	3.09	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	1	10010007	2-5542-60877-88-7	\N	1	สุทธิพงษ์	\N	อ่อนน้อม	1	1	0	0	2	ถนนสุรวงศ์	\N	\N	5705	2559	113	3	2.62	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010009	8-5023-19851-15-2	\N	3	อัมพร	\N	บุญมี	2	1	0	0	1	ถนนรามคำแหง	\N	\N	9201	2556	423	3	3.55	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010007	5-6971-16365-99-9	\N	3	ปัณฑิตา	\N	กิตติคุณ	2	1	0	0	1	ถนนอุดรดุษฎี	\N	\N	5702	2562	106	1	2.07	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	6-1446-24684-61-3	\N	1	อนุชา	\N	สุจริต	1	1	0	0	7	ถนนสรงประภา	\N	\N	5703	2567	103	1	3.93	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	8-5001-14652-56-2	\N	2	ชลธิชา	\N	ขาวสะอาด	2	1	0	0	6	ถนนเพชรเกษม	\N	\N	5705	2564	104	2	3.89	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	4-1902-86872-29-5	\N	1	วิชญ์พล	\N	เพียรดี	1	1	0	0	1	ถ.เอกชัย	\N	\N	5702	2560	112	3	2.79	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	4	10010007	4-1817-39136-59-4	\N	2	กัญญาณัฐ	\N	ชัยมงคล	2	1	0	0	9	ถนนกลางเมือง	\N	\N	5705	2559	113	2	2.67	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	1-1191-13626-80-5	\N	2	อภิญญา	\N	อินทร์ชัย	2	1	0	0	2	ถนนสุดสาคร	\N	\N	5705	2559	113	3	2.64	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	3	10010007	5-8053-78093-40-2	\N	1	ณัฐวรรธน์	\N	เจริญชัย	1	1	0	0	5	ถนนสุดสาคร	\N	\N	5704	2567	103	1	2.37	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	6-6910-76960-96-5	\N	2	พิมพ์ชนก	\N	อินทร์ชัย	2	1	0	0	7	ถนนวิภาวดีรังสิต	\N	\N	5705	2567	101	3	3.86	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	1-3301-37998-31-1	\N	1	ณัฐพล	\N	จันทร์แก้ว	1	1	0	0	2	ถนนบายพาส	\N	\N	5705	2560	112	3	3.83	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	6-1529-69826-53-2	\N	2	ภัทรวดี	\N	ประสิทธิ์ผล	2	1	0	0	10	ถนนราษฎร์บูรณะ	\N	\N	5701	2562	106	1	3.7	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	7-3613-96753-28-9	\N	3	พรรษา	\N	ยิ้มแย้ม	2	1	0	0	5	ถนนอ่อนนุช	\N	\N	5703	2567	103	2	2.92	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	4	10010007	1-5212-82837-72-2	\N	3	มณีรัตน์	\N	บุญรอด	2	1	0	0	1	ถนนสีลม	\N	\N	5705	2564	104	1	2.22	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	2-5137-48203-28-8	\N	3	แสงดาว	\N	อินทร์ชัย	2	1	0	0	2	ถ.ประชาสามัคคี	\N	\N	5703	2556	423	2	3.5	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	1-1834-16519-28-1	\N	2	เกวลิน	\N	ใจดี	2	1	0	0	7	ถนนมิตรภาพ	\N	\N	5703	2563	105	3	2.74	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	3-5164-36624-62-2	\N	2	กาญจนา	\N	วิไลวรรณ	2	1	0	0	1	ถนนสุขุมวิท	\N	\N	5704	2556	423	1	3.62	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	7-5868-67927-15-3	\N	1	สิรภพ	\N	วิไลวรรณ	1	1	0	0	4	ถนนมาลัยแมน	\N	\N	5701	2564	104	1	2.68	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	1-3742-32735-56-3	\N	1	กวินท์	\N	พันธุ์ดี	1	1	0	0	6	ถนนห้วยแก้ว	\N	\N	5701	2560	112	1	3.57	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	8-7901-34441-33-9	\N	1	บุญยิ่ง	\N	เพียรดี	1	1	0	0	1	ถนนมิตรภาพ	\N	\N	5701	2567	101	2	3.61	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	8-1592-56005-80-5	\N	3	ชลธิชา	\N	เกียรติสกุล	2	1	0	0	9	ถนนราษฎร์บูรณะ	\N	\N	5703	2567	101	1	3.08	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	2	10010007	7-2692-13447-79-3	\N	1	กวินท์	\N	ดีสมัย	1	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	5705	2567	101	1	3.63	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	7-8856-59286-43-8	\N	2	อัมพร	\N	บุญมี	2	1	0	0	9	ถนนมิตรภาพ	\N	\N	5701	2561	111	2	2.9	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	3	10010007	2-6008-42481-83-3	\N	3	รัตนาภรณ์	\N	แสงสว่าง	2	1	0	0	6	ถ.รัฐพัฒนา	\N	\N	5705	2563	105	2	2.12	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	3-9535-55134-90-6	\N	1	มานพ	\N	ชูศรี	1	1	0	0	2	ถนนเยาวราช	\N	\N	5702	2566	102	2	2.68	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	1-5032-34334-96-9	\N	1	คุณากร	\N	สุจริต	1	1	0	0	7	ถนนช้างเผือก	\N	\N	5702	2562	106	3	2.67	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	6-4042-79479-36-1	\N	1	ปิยังกูร	\N	งามดี	1	1	0	0	6	ถนนอ่อนนุช	\N	\N	5701	2559	113	3	2.07	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	4-1869-39752-81-9	\N	1	ภัคพล	\N	กิตติคุณ	1	1	0	0	5	ถนนสุขุมวิท	\N	\N	5702	2556	423	3	3.34	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	4	10010007	2-3015-12277-52-1	\N	1	เอกพงษ์	\N	สกุลดี	1	1	0	0	8	ถนนเพชรเกษม	\N	\N	5704	2557	422	2	3.18	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	5-1401-67212-85-2	\N	3	ปัณฑิตา	\N	กิตติคุณ	2	1	0	0	5	ถนนสุรวงศ์	\N	\N	5703	2558	421	2	3.87	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	6-7105-64152-73-7	\N	3	อัมพร	\N	คงมั่น	2	1	0	0	10	ถนนห้วยแก้ว	\N	\N	5705	2567	103	1	2.41	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	3-8796-38631-31-5	\N	2	เพ็ญพักตร์	\N	ดำรงค์	2	1	0	0	4	ถ.บ้านโป่ง	\N	\N	5704	2557	422	3	2.82	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	1-6348-63617-61-6	\N	1	ชินดนัย	\N	สุจริต	1	1	0	0	2	ถนนเยาวราช	\N	\N	5705	2566	102	3	3.5	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	7-9492-95442-39-3	\N	1	ณัฐวรรธน์	\N	อินทร์ชัย	1	1	0	0	10	ถนนโชคชัย	\N	\N	5703	2560	112	1	3.79	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	2-2692-71707-10-3	\N	2	นภาพร	\N	อ่อนน้อม	2	1	0	0	5	ถนนศรีนครินทร์	\N	\N	5704	2556	423	2	3.62	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	4-8577-42687-78-1	\N	1	ภัคพล	\N	ทั่วถึง	1	1	0	0	2	ถนนสาทร	\N	\N	5702	2561	111	2	3.51	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	8-2954-67336-81-3	\N	1	คุณากร	\N	หอมหวาน	1	1	0	0	7	ถนนรามคำแหง	\N	\N	5702	2560	112	1	2.38	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	4	10010007	3-1412-68357-36-5	\N	1	ชนะชัย	\N	ทั่วถึง	1	1	0	0	8	ถนนนวมินทร์	\N	\N	5703	2566	102	2	3.89	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	6-6717-64730-49-8	\N	2	ประภา	\N	สีดา	2	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	5703	2564	104	1	2.71	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	7-7593-40329-70-1	\N	1	ชูเกียรติ	\N	ประสิทธิ์ผล	1	1	0	0	1	ถนนนวมินทร์	\N	\N	5705	2558	421	2	3.18	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	3	10010007	8-9308-23637-61-6	\N	2	พรทิพย์	\N	ทองดี	2	1	0	0	7	ถนนพหลโยธิน	\N	\N	5701	2556	423	3	3.34	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	1-3127-46870-46-7	\N	1	ณัฐวรรธน์	\N	ธนาคาร	1	1	0	0	3	ถนนประดิษฐ์มนูธรรม	\N	\N	5703	2557	422	3	3.37	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	2	10010007	1-9931-69966-37-7	\N	1	ภัคพล	\N	ใจดี	1	1	0	0	4	ถนนบรมราชชนนี	\N	\N	5704	2556	423	2	3.38	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	3-3485-87263-35-9	\N	2	ดรุณี	\N	สุดสวย	2	1	0	0	1	ถนนนิมมานเหมินท์	\N	\N	5701	2556	423	1	2.38	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	2-7583-47516-72-7	\N	2	พิมพ์ชนก	\N	สุขสบาย	2	1	0	0	5	ถนนศรีนครินทร์	\N	\N	5705	2559	113	2	3.14	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	8-3154-31150-91-8	\N	3	กุลธิดา	\N	ศักดิ์สิทธิ์	2	1	0	0	9	ถนนเพชรเกษม	\N	\N	5701	2557	422	1	3.85	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	4-1559-32925-21-4	\N	1	ประพันธ์	\N	สุวรรณภูมิ	1	1	0	0	7	ถ.บ้านโป่ง	\N	\N	5702	2560	112	1	2.73	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	8-9537-69647-61-1	\N	1	รชานนท์	\N	แสงสว่าง	1	1	0	0	3	ถนนโชคชัย	\N	\N	5702	2567	101	3	2.97	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	4	10010007	2-1062-54368-98-1	\N	2	สุดารัตน์	\N	ลือชา	2	1	0	0	4	ถนนบรมราชชนนี	\N	\N	5702	2567	101	3	3.53	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	4-9848-53114-91-4	\N	2	กาญจนา	\N	สมบูรณ์	2	1	0	0	1	ถนนประดิษฐ์มนูธรรม	\N	\N	5705	2564	104	3	2.64	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	6-5094-87799-50-4	\N	1	ธนาธิป	\N	ธนาคาร	1	1	0	0	7	ถนนเจริญกรุง	\N	\N	5704	2557	422	1	2.55	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	5-9383-64306-22-2	\N	1	ปัณณทัต	\N	สง่างาม	1	1	0	0	6	ถนนอุดรดุษฎี	\N	\N	5702	2564	104	2	2.5	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	4	10010007	5-7319-74384-14-2	\N	1	วิชญ์พล	\N	แสงสว่าง	1	1	0	0	5	ถนนงามวงศ์วาน	\N	\N	5704	2556	423	3	2.06	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	3-1608-83641-35-7	\N	1	นพรัตน์	\N	สุขสบาย	1	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	5703	2556	423	2	2.21	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	2	10010007	7-2150-72868-38-3	\N	3	สุดารัตน์	\N	ประสิทธิ์ผล	2	1	0	0	8	ถ.รัฐพัฒนา	\N	\N	5702	2558	421	2	3.09	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	2-4935-63430-81-1	\N	3	ณัฐนิชา	\N	งามดี	2	1	0	0	7	ถนนกลางเมือง	\N	\N	5702	2566	102	3	3.53	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	1	10010009	7-8862-73628-74-2	\N	1	ธัชพล	\N	หอมหวาน	1	1	0	0	4	ถนนเยาวราช	\N	\N	9204	2557	422	2	3.3	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010007	4-7802-63040-41-4	\N	2	วิมลรัตน์	\N	สุดสวย	2	1	0	0	8	ถนนกลางเมือง	\N	\N	5704	2562	106	3	2.5	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	8-9594-57473-82-3	\N	3	กัญญาณัฐ	\N	สุวรรณภูมิ	2	1	0	0	10	ถนนกาญจนาภิเษก	\N	\N	5702	2563	105	2	2.91	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	4-8205-48225-49-9	\N	2	วาสนา	\N	รุ่งเรือง	2	1	0	0	10	ถนนราษฎร์บูรณะ	\N	\N	5701	2556	423	3	3.86	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	5-6314-10569-33-6	\N	1	ทัศนัย	\N	นิ่มนวล	1	1	0	0	7	ถ.บ้านโป่ง	\N	\N	5704	2563	105	2	2.26	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	2-7520-24211-10-4	\N	1	อภิวัฒน์	\N	ศรีสุข	1	1	0	0	8	ถนนมาลัยแมน	\N	\N	5704	2567	101	1	3.43	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	1-5981-38032-72-5	\N	1	ทัศนัย	\N	เพ็งพา	1	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	5705	2562	106	1	2.45	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	3	10010007	1-9585-64159-23-8	\N	2	เพ็ญพักตร์	\N	วิริยะ	2	1	0	0	1	ถ.บ้านโป่ง	\N	\N	5704	2559	113	2	3.72	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	5-1528-31819-96-8	\N	1	ทักษิณ	\N	ธนาคาร	1	1	0	0	6	ถนนวิภาวดีรังสิต	\N	\N	5702	2560	112	1	2.26	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	4	10010007	6-6232-72230-48-9	\N	1	สมชาย	\N	ทองดี	1	1	0	0	7	ถนนสาทร	\N	\N	5701	2563	105	2	2.9	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	1-6584-61680-17-6	\N	1	นพรัตน์	\N	ใจดี	1	1	0	0	6	ถ.เอกชัย	\N	\N	5701	2556	423	3	3.5	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	1-1469-66569-58-2	\N	1	คุณากร	\N	วังขวา	1	1	0	0	7	ถนนงามวงศ์วาน	\N	\N	5703	2567	101	1	3.36	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	4	10010007	3-5805-48256-98-6	\N	2	กุลธิดา	\N	มีสุข	2	1	0	0	7	ถ.รัฐพัฒนา	\N	\N	5704	2558	421	1	3.61	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	2	10010007	7-8398-53010-68-6	\N	1	ธนพัฒน์	\N	วงษ์สุวรรณ	1	1	0	0	6	ถนนเยาวราช	\N	\N	5703	2567	101	1	3.64	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	6-4184-40863-77-9	\N	3	ณัฐนิชา	\N	ศักดิ์สิทธิ์	2	1	0	0	3	ถนนนิมมานเหมินท์	\N	\N	5702	2567	101	1	3.13	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	2-9419-71112-50-9	\N	3	มาลัย	\N	เจริญชัย	2	1	0	0	9	ถนนลาดพร้าว	\N	\N	5701	2562	106	3	3.56	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	5-9625-68315-43-6	\N	3	ภัทรวดี	\N	ยิ้มแย้ม	2	1	0	0	2	ถนนสรงประภา	\N	\N	5701	2566	102	2	3.97	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	4-1360-88729-92-5	\N	2	สุภัสสรา	\N	มีสุข	2	1	0	0	5	ถนนสาทร	\N	\N	5705	2561	111	1	2.48	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	6-6412-67609-87-1	\N	1	ณัฐวรรธน์	\N	เพ็งพา	1	1	0	0	1	ถ.เอกชัย	\N	\N	5701	2558	421	2	3.99	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	4-1940-60015-92-4	\N	1	ชาตรี	\N	ประสิทธิ์ผล	1	1	0	0	7	ถนนมิตรภาพ	\N	\N	5704	2556	423	2	2.26	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	1-5666-22981-40-7	\N	2	ปิยนุช	\N	มีสุข	2	1	0	0	8	ถ.รัฐพัฒนา	\N	\N	5701	2561	111	1	3.94	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	4-3107-27380-44-7	\N	3	นภาพร	\N	คงพิทักษ์	2	1	0	0	8	ถนนสาทร	\N	\N	5703	2567	103	3	3.45	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	2-3165-13946-87-5	\N	3	กัญญาณัฐ	\N	ลือชา	2	1	0	0	6	ถนนเยาวราช	\N	\N	5703	2567	103	2	3.25	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	3-7177-87071-67-7	\N	1	ดิศรณ์	\N	บุญรอด	1	1	0	0	10	ถนนกาญจนาภิเษก	\N	\N	5705	2559	113	2	2.41	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	7-9293-89211-84-7	\N	1	ปัณณทัต	\N	สุจริต	1	1	0	0	10	ถนนพหลโยธิน	\N	\N	5704	2560	112	2	2.54	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	4-6301-86557-14-5	\N	3	ปิยนุช	\N	อินทร์ชัย	2	1	0	0	10	ถนนรัตนาธิเบศร์	\N	\N	5705	2563	105	2	2.24	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	3-6935-49342-44-6	\N	3	วิมลรัตน์	\N	บริบูรณ์	2	1	0	0	3	ถ.เอกชัย	\N	\N	5703	2559	113	2	2.11	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	3-8786-46341-17-8	\N	2	ชลธิชา	\N	คงพิทักษ์	2	1	0	0	6	ถนนบรมราชชนนี	\N	\N	5703	2562	106	2	3.65	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	4	10010007	3-1507-39935-50-7	\N	1	ทักษิณ	\N	ศรีสุข	1	1	0	0	9	ถนนรามคำแหง	\N	\N	5703	2559	113	1	2.48	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	1-8695-56953-13-2	\N	1	นพรัตน์	\N	อ่อนน้อม	1	1	0	0	4	ถนนสาทร	\N	\N	5703	2562	106	2	2.96	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	5-7462-42090-21-8	\N	1	ณัฐวุฒิ	\N	ประสิทธิ์ผล	1	1	0	0	8	ถนนงามวงศ์วาน	\N	\N	5704	2563	105	2	3.38	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	4-4710-83624-60-4	\N	3	ธัญชนก	\N	รุ่งเรือง	2	1	0	0	9	ถนนรามคำแหง	\N	\N	5704	2561	111	2	2.33	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	7-5966-13568-88-5	\N	1	ธนภัทร	\N	ดีสมัย	1	1	0	0	7	ถนนสุดสาคร	\N	\N	5702	2567	101	1	2.95	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	5-5070-43647-82-6	\N	3	อภิญญา	\N	มีสุข	2	1	0	0	5	ถนนเพชรเกษม	\N	\N	5701	2564	104	1	2.91	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	1-2249-33151-77-4	\N	1	ชนะชัย	\N	อ่อนน้อม	1	1	0	0	5	ถนนโชคชัย	\N	\N	5704	2566	102	1	2.57	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	6-5032-60504-51-1	\N	1	ปิยังกูร	\N	สุขสบาย	1	1	0	0	5	ถนนมิตรภาพ	\N	\N	5701	2561	111	1	3.68	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	2-3775-38636-34-2	\N	3	ปิยนุช	\N	นิ่มนวล	2	1	0	0	6	ถนนสรงประภา	\N	\N	5704	2563	105	1	2.08	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	5-3382-70577-64-9	\N	3	พิมพ์ชนก	\N	ศรีสุข	2	1	0	0	7	ถนนบรมราชชนนี	\N	\N	5703	2556	423	2	3.03	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	2	10010007	6-8141-90681-49-3	\N	1	สุรชัย	\N	มีสุข	1	1	0	0	1	ถนนบรมราชชนนี	\N	\N	5705	2564	104	1	2.61	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	3-6963-16953-63-5	\N	3	ปาณิสรา	\N	มีสุข	2	1	0	0	2	ถนนพหลโยธิน	\N	\N	5704	2564	104	1	2.95	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	8-5025-97604-33-7	\N	1	วรากร	\N	บุญรอด	1	1	0	0	6	ถนนสรงประภา	\N	\N	5703	2560	112	3	3.3	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	6-5611-66293-18-3	\N	1	สิรภพ	\N	ยิ้มแย้ม	1	1	0	0	1	ถนนสีลม	\N	\N	5704	2557	422	3	3.79	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	1-2247-88904-75-3	\N	3	วันวิสา	\N	บริบูรณ์	2	1	0	0	9	ถนนรามคำแหง	\N	\N	5702	2557	422	2	2.61	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	5-3951-54938-90-7	\N	2	แสงดาว	\N	ปัญญาดี	2	1	0	0	3	ถนนนวมินทร์	\N	\N	5703	2564	104	2	3.78	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	5-8448-53659-19-4	\N	2	วันวิสา	\N	กิตติคุณ	2	1	0	0	5	ถนนลาดพร้าว	\N	\N	5705	2557	422	1	3.56	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	6-9776-28160-95-5	\N	3	แสงดาว	\N	นิ่มนวล	2	1	0	0	1	ถนนมิตรภาพ	\N	\N	5701	2564	104	3	2.77	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	1-8057-24240-22-6	\N	3	อภิญญา	\N	วังขวา	2	1	0	0	10	ถ.รัฐพัฒนา	\N	\N	5703	2564	104	1	2.31	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	4-2946-51365-78-5	\N	1	วสันต์	\N	มีสุข	1	1	0	0	7	ถนนนิมมานเหมินท์	\N	\N	5702	2561	111	1	3.62	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	6-5164-98180-12-1	\N	1	ทัศนัย	\N	คงพิทักษ์	1	1	0	0	10	ถนนราษฎร์บูรณะ	\N	\N	5703	2564	104	1	3.18	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	4-1247-54861-97-4	\N	1	ชนะชัย	\N	ดำรงค์	1	1	0	0	10	ถนนสุขุมวิท	\N	\N	5703	2557	422	2	3.12	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	2	10010007	3-7363-28636-13-6	\N	1	ปัณณทัต	\N	งามดี	1	1	0	0	6	ถนนกลางเมือง	\N	\N	5703	2564	104	1	3.54	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	6-7300-55232-66-9	\N	3	สุมาลี	\N	ปัญญาดี	2	1	0	0	4	ถนนสีลม	\N	\N	5702	2566	102	2	3.41	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	6-2301-80712-74-9	\N	1	ไกรวุฒิ	\N	ชูศรี	1	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	5703	2563	105	1	2.06	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	6-8901-33607-75-4	\N	2	ปิยนุช	\N	ธนาคาร	2	1	0	0	10	ถ.ประชาสามัคคี	\N	\N	5705	2562	106	3	3.69	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	6-9562-48326-61-1	\N	1	ธนภัทร	\N	สุจริต	1	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	5701	2559	113	3	3.12	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	4-3564-68655-22-9	\N	2	สุนิสา	\N	เพียรดี	2	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	5703	2564	104	3	3.04	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	1-3165-14529-72-6	\N	3	ปิยนุช	\N	ปัญญาดี	2	1	0	0	3	ถนนลาดพร้าว	\N	\N	5703	2560	112	3	3.1	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	2	10010007	7-5254-79857-42-8	\N	2	จิราพร	\N	บริบูรณ์	2	1	0	0	8	ถนนอ่อนนุช	\N	\N	5703	2563	105	3	2.04	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	8-4858-93289-22-8	\N	1	กิตติภณ	\N	รักษ์ไทย	1	1	0	0	2	ถนนนวมินทร์	\N	\N	5703	2558	421	2	2.03	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	8-3945-90009-97-2	\N	1	รัฐนนท์	\N	ใจดี	1	1	0	0	7	ถนนเยาวราช	\N	\N	5702	2562	106	1	3.51	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	4	10010007	8-2085-13826-72-4	\N	1	ภัคพล	\N	วงษ์สุวรรณ	1	1	0	0	6	ถนนศรีนครินทร์	\N	\N	5704	2567	101	3	3.13	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	4-1187-95382-10-2	\N	3	เกวลิน	\N	เกียรติสกุล	2	1	0	0	7	ถนนบรมราชชนนี	\N	\N	5702	2567	101	3	2.87	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	1-9065-48693-18-7	\N	1	ธนาธิป	\N	วงษ์สุวรรณ	1	1	0	0	7	ถนนกาญจนาภิเษก	\N	\N	5703	2567	103	3	3.88	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	4-2579-62143-72-3	\N	1	กิตติภณ	\N	ศักดิ์สิทธิ์	1	1	0	0	4	ถนนสรงประภา	\N	\N	5704	2567	103	2	2.47	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	7-2004-66368-68-4	\N	3	นภาพร	\N	นามมนตรี	2	1	0	0	8	ถ.รัฐพัฒนา	\N	\N	5704	2562	106	1	2.76	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	8-3636-89701-13-9	\N	1	วรากร	\N	หอมหวาน	1	1	0	0	5	ถ.เอกชัย	\N	\N	5701	2563	105	1	2.08	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	7-5447-70942-91-7	\N	1	วรพล	\N	จันทร์แก้ว	1	1	0	0	6	ถนนนวมินทร์	\N	\N	5701	2563	105	1	3.47	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	4-7528-92369-69-6	\N	3	พรรษา	\N	มีสุข	2	1	0	0	10	ถนนกาญจนาภิเษก	\N	\N	5705	2557	422	1	3.61	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	4-8914-79370-46-9	\N	2	จิตรลดา	\N	สุขสันต์	2	1	0	0	7	ถนนห้วยแก้ว	\N	\N	5701	2556	423	3	3.43	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	4-4171-44676-37-1	\N	1	นรวิชญ์	\N	สง่างาม	1	1	0	0	5	ถนนนวมินทร์	\N	\N	5701	2558	421	1	2.58	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	7-8677-55811-53-5	\N	1	ภูมิพัฒน์	\N	ธนาคาร	1	1	0	0	8	ถนนมิตรภาพ	\N	\N	5704	2561	111	1	2.24	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	2-7953-37632-77-3	\N	1	สมศักดิ์	\N	สง่างาม	1	1	0	0	6	ถนนบรมราชชนนี	\N	\N	5705	2560	112	2	3.58	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	6-9305-31476-21-8	\N	1	สุรชัย	\N	มงคล	1	1	0	0	3	ถนนบายพาส	\N	\N	5702	2558	421	1	2.38	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	5-1213-80158-98-9	\N	1	ณัฐวรรธน์	\N	พงษ์ไพร	1	1	0	0	7	ถนนบรมราชชนนี	\N	\N	5701	2560	112	1	3.57	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	4-1984-62141-50-8	\N	1	ดิศรณ์	\N	สง่างาม	1	1	0	0	8	ถนนสรงประภา	\N	\N	5703	2557	422	1	2.61	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	2-1012-84012-77-2	\N	1	ชนะชัย	\N	บุญมี	1	1	0	0	8	ถนนมาลัยแมน	\N	\N	5704	2561	111	3	2.93	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	8-4309-95649-67-2	\N	3	พรทิพย์	\N	บุญมี	2	1	0	0	2	ถนนพหลโยธิน	\N	\N	5701	2559	113	1	3.86	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	5-7867-50257-22-5	\N	2	ประภา	\N	ประสิทธิ์ผล	2	1	0	0	8	ถนนสุรวงศ์	\N	\N	5705	2556	423	3	3.29	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	8-5781-34344-53-3	\N	3	จิตรลดา	\N	สกุลดี	2	1	0	0	6	ถ.รัฐพัฒนา	\N	\N	5705	2567	101	2	2.79	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	6-2448-60859-90-7	\N	3	นภาพร	\N	วังขวา	2	1	0	0	1	ถนนสีลม	\N	\N	5704	2567	103	3	3.69	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	2-5342-98650-12-6	\N	1	บุญยิ่ง	\N	อ่อนน้อม	1	1	0	0	1	ถ.ประชาสามัคคี	\N	\N	5702	2563	105	3	3.66	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	4-3307-39307-17-5	\N	1	สมชาย	\N	อ่อนน้อม	1	1	0	0	8	ถ.บ้านโป่ง	\N	\N	5701	2562	106	3	3.89	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	6-6645-99748-90-4	\N	1	ชาตรี	\N	วังขวา	1	1	0	0	4	ถนนโชคชัย	\N	\N	5705	2561	111	1	3.46	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	2-6257-63559-60-1	\N	3	กัญญาณัฐ	\N	บุญมี	2	1	0	0	4	ถนนสุขุมวิท	\N	\N	5705	2561	111	2	2.53	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	5-4355-63400-41-6	\N	1	สมชาย	\N	วงษ์สุวรรณ	1	1	0	0	7	ถนนเจริญกรุง	\N	\N	5705	2564	104	2	3.88	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	4-5659-73863-28-5	\N	1	อนุชา	\N	พรประเสริฐ	1	1	0	0	5	ถนนเพชรเกษม	\N	\N	5704	2563	105	3	3.26	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	4-1337-90902-62-5	\N	3	พรรษา	\N	รักษ์ไทย	2	1	0	0	8	ถนนนิมมานเหมินท์	\N	\N	5701	2560	112	2	3.49	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	5-9560-73310-13-3	\N	1	ไกรวุฒิ	\N	ยิ้มแย้ม	1	1	0	0	10	ถนนช้างเผือก	\N	\N	5702	2567	103	2	3.15	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	5-6708-44709-77-3	\N	1	รชานนท์	\N	สุจริต	1	1	0	0	7	ถนนสรงประภา	\N	\N	5702	2558	421	3	3.18	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	3-8617-61557-61-4	\N	2	กาญจนา	\N	อินทร์ชัย	2	1	0	0	5	ถนนพหลโยธิน	\N	\N	5701	2567	103	2	3.14	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	3	10010007	3-3114-49760-61-7	\N	3	ภัทรวดี	\N	ทั่วถึง	2	1	0	0	9	ถนนช้างเผือก	\N	\N	5703	2558	421	2	2.85	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	8-2709-42445-57-3	\N	1	รชานนท์	\N	ชูศรี	1	1	0	0	9	ถนนนิมมานเหมินท์	\N	\N	5702	2567	103	2	2.87	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	1	10010007	8-5256-99515-52-9	\N	3	ปาณิสรา	\N	มณีรัตน์	2	1	0	0	1	ถ.บ้านโป่ง	\N	\N	5703	2560	112	3	2.05	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	4-2948-33435-68-7	\N	3	สุนิสา	\N	บุญรอด	2	1	0	0	1	ถ.บ้านโป่ง	\N	\N	5704	2567	103	2	2.41	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	3-5196-57488-26-5	\N	1	ชินดนัย	\N	สุวรรณภูมิ	1	1	0	0	9	ถนนนวมินทร์	\N	\N	5705	2563	105	3	2.35	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	3	10010007	8-7945-56248-49-7	\N	1	วีรชัย	\N	สุขสบาย	1	1	0	0	2	ถนนเยาวราช	\N	\N	5702	2564	104	1	2.76	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	1	10010007	5-8577-39148-82-2	\N	1	ชนะชัย	\N	อ่อนน้อม	1	1	0	0	3	ถนนโชคชัย	\N	\N	5705	2563	105	1	3.31	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	3	10010007	1-2622-27651-68-8	\N	1	ณัฐวุฒิ	\N	พรประเสริฐ	1	1	0	0	2	ถนนสรงประภา	\N	\N	5703	2558	421	3	3.97	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	1-2574-99279-67-5	\N	2	ศิริพร	\N	วิไลวรรณ	2	1	0	0	5	ถ.บ้านโป่ง	\N	\N	5704	2562	106	2	2.39	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	3-3729-84209-91-1	\N	2	พิมพ์ชนก	\N	เพียรดี	2	1	0	0	7	ถนนเยาวราช	\N	\N	5702	2559	113	3	3.19	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	1-3532-84061-41-8	\N	1	ไกรวุฒิ	\N	นิ่มนวล	1	1	0	0	7	ถนนเยาวราช	\N	\N	5704	2559	113	3	3.5	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	1-3762-41195-80-7	\N	3	อรณิชา	\N	ยิ้มแย้ม	2	1	0	0	6	ถนนมาลัยแมน	\N	\N	5703	2558	421	2	3.93	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	1-2968-78902-80-9	\N	1	รชานนท์	\N	ทองดี	1	1	0	0	1	ถนนพหลโยธิน	\N	\N	5701	2558	421	1	2.73	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	7-9583-72791-90-3	\N	1	ธนภัทร	\N	สุขสบาย	1	1	0	0	3	ถนนรัตนาธิเบศร์	\N	\N	5703	2567	101	2	3.31	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	7-3786-31797-36-8	\N	1	ธนภัทร	\N	บริบูรณ์	1	1	0	0	7	ถนนสุดสาคร	\N	\N	5701	2561	111	3	2.31	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	2-1974-68371-10-3	\N	1	รัฐนนท์	\N	เกียรติสกุล	1	1	0	0	8	ถนนสรงประภา	\N	\N	5703	2567	103	2	3.73	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	2	10010007	4-6441-80508-40-5	\N	1	อนุชา	\N	คงพิทักษ์	1	1	0	0	10	ถนนราษฎร์บูรณะ	\N	\N	5703	2563	105	3	3.12	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	2-1868-89872-28-4	\N	3	กุลธิดา	\N	อ่อนน้อม	2	1	0	0	4	ถนนกลางเมือง	\N	\N	5703	2559	113	2	2.7	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	7-4531-94887-76-2	\N	3	ปิยนุช	\N	บริบูรณ์	2	1	0	0	7	ถนนบรมราชชนนี	\N	\N	5702	2562	106	3	2.44	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	4	10010007	3-7707-21310-44-1	\N	1	สมชาย	\N	วิไลวรรณ	1	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	5705	2557	422	2	2.42	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	3	10010007	1-4065-70843-86-9	\N	1	ภัคพล	\N	บริบูรณ์	1	1	0	0	10	ถนนเพชรเกษม	\N	\N	5705	2558	421	3	3.32	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	2-8753-92094-30-9	\N	3	เกวลิน	\N	บุญรอด	2	1	0	0	5	ถนนช้างเผือก	\N	\N	5701	2556	423	3	3.9	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	3	10010007	3-7895-34097-80-9	\N	3	บุษยา	\N	นามมนตรี	2	1	0	0	7	ถนนมิตรภาพ	\N	\N	5705	2561	111	1	3.72	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	1-6824-69877-12-2	\N	1	วุฒิพงษ์	\N	เพียรดี	1	1	0	0	10	ถ.บ้านโป่ง	\N	\N	5702	2562	106	1	3.11	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	3-6409-55068-99-6	\N	3	สิริมา	\N	มีสุข	2	1	0	0	7	ถนนโชคชัย	\N	\N	5703	2567	103	3	3.83	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	1-1023-23623-53-9	\N	1	อนุชา	\N	สุดสวย	1	1	0	0	2	ถนนสรงประภา	\N	\N	5705	2557	422	2	3.64	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	3	10010007	5-8921-98917-14-1	\N	1	วีรชัย	\N	มงคล	1	1	0	0	3	ถนนมิตรภาพ	\N	\N	5702	2564	104	3	2.54	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	4	10010007	3-6050-45299-64-1	\N	1	สุทธิพงษ์	\N	สุดสวย	1	1	0	0	10	ถนนกลางเมือง	\N	\N	5701	2559	113	3	2.9	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	8-7329-41826-16-9	\N	3	ดวงใจ	\N	เพ็งพา	2	1	0	0	4	ถนนช้างเผือก	\N	\N	5703	2557	422	2	2.97	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	7-5093-45000-92-8	\N	2	อรณิชา	\N	นิ่มนวล	2	1	0	0	5	ถนนบรมราชชนนี	\N	\N	5701	2557	422	1	3.43	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	4-1252-51422-82-8	\N	1	สิรภพ	\N	สง่างาม	1	1	0	0	6	ถ.รัฐพัฒนา	\N	\N	5702	2567	103	3	2.48	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	8-7195-55117-67-6	\N	1	นรวิชญ์	\N	สง่างาม	1	1	0	0	6	ถนนมิตรภาพ	\N	\N	5704	2556	423	3	3.5	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	6-1400-65862-59-5	\N	1	ชาตรี	\N	วิริยะ	1	1	0	0	9	ถ.เอกชัย	\N	\N	5704	2556	423	2	3.88	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	1-1840-17045-32-6	\N	1	บุญยิ่ง	\N	ประสิทธิ์ผล	1	1	0	0	6	ถนนเยาวราช	\N	\N	5703	2558	421	2	2.22	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	2	10010007	6-3232-86672-43-9	\N	3	นวลจันทร์	\N	ชัยมงคล	2	1	0	0	5	ถนนวิภาวดีรังสิต	\N	\N	5702	2562	106	2	2.89	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	7-4473-35667-71-1	\N	3	พิมพ์ชนก	\N	ปัญญาดี	2	1	0	0	7	ถนนช้างเผือก	\N	\N	5701	2562	106	2	2.07	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	4-9762-94533-66-6	\N	1	วรากร	\N	พรประเสริฐ	1	1	0	0	10	ถนนมิตรภาพ	\N	\N	5701	2566	102	2	3.47	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	4-5032-94893-29-5	\N	3	ดรุณี	\N	เพ็งพา	2	1	0	0	2	ถ.รัฐพัฒนา	\N	\N	5702	2567	101	3	3.91	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	1	10010007	7-8233-70395-47-4	\N	2	สุมาลี	\N	วงษ์สุวรรณ	2	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	5705	2566	102	1	3.57	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	3	10010007	2-5231-39275-97-7	\N	2	บุษยา	\N	ชูศรี	2	1	0	0	10	ถนนกาญจนาภิเษก	\N	\N	5705	2566	102	3	2.73	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	4-9284-64776-20-7	\N	2	ปาณิสรา	\N	ยิ้มแย้ม	2	1	0	0	2	ถนนเจริญกรุง	\N	\N	5703	2557	422	2	3.39	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	5-4097-20655-89-7	\N	3	พรรษา	\N	ขาวสะอาด	2	1	0	0	6	ถนนราษฎร์บูรณะ	\N	\N	5703	2567	103	3	2.3	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	6-4173-96933-18-3	\N	1	อนุชา	\N	มีสุข	1	1	0	0	7	ถนนสุขุมวิท	\N	\N	5705	2562	106	3	3.58	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	5-6505-91418-57-9	\N	3	ชนิดา	\N	ขาวสะอาด	2	1	0	0	8	ถนนอุดรดุษฎี	\N	\N	5701	2557	422	3	3.99	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	1-9126-77951-40-8	\N	2	ทิพย์สุดา	\N	ยิ้มแย้ม	2	1	0	0	4	ถนนเพชรเกษม	\N	\N	5702	2566	102	3	2.64	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	1	10010007	5-6370-86415-32-4	\N	1	สมชาย	\N	ชูศรี	1	1	0	0	3	ถนนกลางเมือง	\N	\N	5703	2556	423	1	3.47	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	2-2665-60228-32-8	\N	1	เอกพงษ์	\N	สมบูรณ์	1	1	0	0	5	ถนนสาทร	\N	\N	5703	2566	102	2	3.76	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	8-1896-30166-36-2	\N	3	ภัทรวดี	\N	คงพิทักษ์	2	1	0	0	8	ถนนเยาวราช	\N	\N	5702	2556	423	2	2.4	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	1	10010007	8-7354-40463-47-5	\N	1	ปรเมศวร์	\N	พรประเสริฐ	1	1	0	0	4	ถนนสาทร	\N	\N	5701	2557	422	2	2.01	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	6-7522-46402-19-7	\N	3	แสงดาว	\N	สุขสบาย	2	1	0	0	3	ถนนประดิษฐ์มนูธรรม	\N	\N	5702	2557	422	1	2.49	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	1	10010007	2-5407-98868-91-4	\N	2	ปัณฑิตา	\N	ชัยมงคล	2	1	0	0	6	ถนนเพชรเกษม	\N	\N	5702	2563	105	2	3.44	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	5-9781-57666-31-7	\N	2	อรณิชา	\N	เพียรดี	2	1	0	0	1	ถนนชัยพฤกษ์	\N	\N	5704	2562	106	2	2.09	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	2	10010007	6-6901-41084-15-7	\N	1	ชาตรี	\N	พันธุ์ดี	1	1	0	0	2	ถนนรามคำแหง	\N	\N	5704	2566	102	1	2.88	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	3-8754-57682-91-3	\N	1	ทักษิณ	\N	มณีรัตน์	1	1	0	0	4	ถนนกาญจนาภิเษก	\N	\N	5701	2564	104	2	3.38	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	3	10010007	4-4587-53839-56-6	\N	1	ธนพัฒน์	\N	กิตติคุณ	1	1	0	0	7	ถนนสุรวงศ์	\N	\N	5701	2564	104	2	3.21	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	8-5867-79451-59-9	\N	2	มาลัย	\N	พรประเสริฐ	2	1	0	0	1	ถนนลาดพร้าว	\N	\N	5702	2564	104	2	3.79	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	3-7652-92531-59-1	\N	3	จันทร์เพ็ญ	\N	กิตติคุณ	2	1	0	0	10	ถนนวิภาวดีรังสิต	\N	\N	5702	2559	113	3	2.01	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	6-1254-53666-62-7	\N	1	พิพัฒน์	\N	หอมหวาน	1	1	0	0	6	ถนนห้วยแก้ว	\N	\N	5704	2566	102	1	2.65	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	8-3180-31470-35-3	\N	1	ชัยชนะ	\N	ประสิทธิ์ผล	1	1	0	0	5	ถนนศรีนครินทร์	\N	\N	5703	2566	102	2	3.8	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	2-2720-14873-64-8	\N	1	สิรภพ	\N	พงษ์ไพร	1	1	0	0	2	ถนนสุรวงศ์	\N	\N	5701	2567	103	2	2.63	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	2-5935-29265-16-3	\N	2	ประภา	\N	ชัยมงคล	2	1	0	0	9	ถนนสุดสาคร	\N	\N	5705	2563	105	3	3.59	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	2-5416-10259-26-5	\N	1	ปรเมศวร์	\N	ปัญญาดี	1	1	0	0	6	ถนนนิมมานเหมินท์	\N	\N	5702	2566	102	1	3.33	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	1-3435-40335-98-3	\N	1	อภิวัฒน์	\N	หอมหวาน	1	1	0	0	1	ถนนพหลโยธิน	\N	\N	5705	2558	421	1	2.57	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	3-9922-96414-96-3	\N	1	ชนะชัย	\N	ดีสมัย	1	1	0	0	5	ถนนสุรวงศ์	\N	\N	5702	2557	422	3	3.88	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	3-6287-59890-24-8	\N	3	วรรณภา	\N	ดำรงค์	2	1	0	0	7	ถนนศรีนครินทร์	\N	\N	5701	2564	104	2	2.61	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	8-8509-86024-56-4	\N	3	วันวิสา	\N	รุ่งเรือง	2	1	0	0	7	ถนนงามวงศ์วาน	\N	\N	5704	2559	113	2	2.11	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	4-4890-59377-17-3	\N	2	พิมพ์ชนก	\N	สุขสบาย	2	1	0	0	8	ถนนอ่อนนุช	\N	\N	5704	2562	106	3	2.11	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	2-9026-35926-64-3	\N	1	วรพล	\N	ชัยมงคล	1	1	0	0	10	ถนนชัยพฤกษ์	\N	\N	5704	2567	101	3	2.75	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	3-5927-35460-74-3	\N	3	ชนิดา	\N	วังขวา	2	1	0	0	2	ถนนกาญจนาภิเษก	\N	\N	5704	2557	422	1	3.09	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	2	10010007	4-9553-20841-35-9	\N	2	รัตนาภรณ์	\N	เพ็งพา	2	1	0	0	6	ถนนศรีนครินทร์	\N	\N	5702	2562	106	3	3.71	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	1	10010007	1-5772-15553-97-2	\N	1	นรวิชญ์	\N	ชัยมงคล	1	1	0	0	5	ถนนนิมมานเหมินท์	\N	\N	5705	2564	104	2	2.46	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	3-5122-58454-59-8	\N	1	ดิศรณ์	\N	ขาวสะอาด	1	1	0	0	1	ถนนเจริญกรุง	\N	\N	5703	2556	423	1	3.18	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	3-4099-35770-92-8	\N	1	สุทธิพงษ์	\N	วังขวา	1	1	0	0	5	ถนนรามคำแหง	\N	\N	5702	2557	422	1	2.56	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	6-2305-89876-12-6	\N	3	กุลธิดา	\N	ศักดิ์สิทธิ์	2	1	0	0	4	ถนนลาดพร้าว	\N	\N	5702	2567	103	3	3.14	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	3-6658-72521-26-4	\N	3	เกวลิน	\N	เกียรติสกุล	2	1	0	0	3	ถนนอ่อนนุช	\N	\N	5705	2566	102	1	3.26	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	2-8139-89036-48-9	\N	1	ธนภัทร	\N	ลือชา	1	1	0	0	5	ถนนสุดสาคร	\N	\N	5701	2560	112	2	3.75	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	5-9973-42717-56-7	\N	3	วิมลรัตน์	\N	สีดา	2	1	0	0	6	ถนนลาดพร้าว	\N	\N	5703	2556	423	3	3.24	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	4	10010007	3-6454-27063-96-6	\N	2	ดรุณี	\N	เพียรดี	2	1	0	0	5	ถนนเพชรเกษม	\N	\N	5702	2559	113	3	2	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	3-5968-19398-28-7	\N	1	เอกพงษ์	\N	เพียรดี	1	1	0	0	7	ถ.ประชาสามัคคี	\N	\N	5701	2567	103	2	3.53	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	3	10010007	7-5951-73422-14-4	\N	2	นวลจันทร์	\N	ธนาคาร	2	1	0	0	4	ถนนอุดรดุษฎี	\N	\N	5705	2557	422	1	3.48	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	7-6245-45475-38-3	\N	3	รัตนาภรณ์	\N	สุขสันต์	2	1	0	0	7	ถนนงามวงศ์วาน	\N	\N	5703	2560	112	3	2.31	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	4	10010007	5-4114-25697-15-2	\N	3	พรทิพย์	\N	แสงสว่าง	2	1	0	0	6	ถนนมาลัยแมน	\N	\N	5702	2567	101	1	3.02	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	3	10010007	2-4052-31434-56-3	\N	1	ชัยชนะ	\N	มณีรัตน์	1	1	0	0	7	ถนนกาญจนาภิเษก	\N	\N	5705	2562	106	1	3.45	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	7-5759-46937-30-9	\N	3	วิมลรัตน์	\N	ศักดิ์สิทธิ์	2	1	0	0	7	ถนนสีลม	\N	\N	5704	2563	105	2	2.88	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	1-2133-14805-23-3	\N	1	เจษฎา	\N	เพียรดี	1	1	0	0	5	ถนนวิภาวดีรังสิต	\N	\N	5701	2567	103	3	2.34	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	3	10010007	8-6036-86862-93-1	\N	1	ประพันธ์	\N	ประสิทธิ์ผล	1	1	0	0	1	ถนนกาญจนาภิเษก	\N	\N	5705	2561	111	1	2.39	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	4-2169-48461-82-3	\N	2	มาลัย	\N	ปัญญาดี	2	1	0	0	1	ถนนวิภาวดีรังสิต	\N	\N	5701	2558	421	2	2.34	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	3	10010007	2-3131-19618-17-8	\N	1	ภูมิพัฒน์	\N	วังขวา	1	1	0	0	1	ถนนกาญจนาภิเษก	\N	\N	5704	2560	112	1	3.78	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	3	10010007	6-9555-77313-68-9	\N	1	วรากร	\N	มณีรัตน์	1	1	0	0	6	ถนนลาดพร้าว	\N	\N	5703	2566	102	1	2.83	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	4	10010007	5-2900-44718-76-4	\N	2	สุนิสา	\N	สง่างาม	2	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	5704	2558	421	2	3.29	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	8-8768-16783-97-3	\N	2	จิราพร	\N	ดำรงค์	2	1	0	0	2	ถนนช้างเผือก	\N	\N	5703	2558	421	2	3.44	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	2-8117-32828-70-2	\N	1	ปิยังกูร	\N	เจริญชัย	1	1	0	0	5	ถนนสาทร	\N	\N	5701	2564	104	2	2.42	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	7-6334-11365-90-5	\N	2	เพ็ญพักตร์	\N	หอมหวาน	2	1	0	0	8	ถนนศรีนครินทร์	\N	\N	5701	2556	423	2	2.21	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	2-4062-29087-10-8	\N	2	มณีรัตน์	\N	ศรีสุข	2	1	0	0	3	ถนนห้วยแก้ว	\N	\N	5701	2558	421	1	3	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	3	10010007	5-1327-81931-76-7	\N	1	ปิยังกูร	\N	อ่อนน้อม	1	1	0	0	1	ถนนอุดรดุษฎี	\N	\N	5703	2563	105	3	3.5	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	2	10010007	1-4892-19748-85-2	\N	1	ณัฐวุฒิ	\N	สง่างาม	1	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	5702	2559	113	2	2.08	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	1	10010007	8-2812-86969-27-3	\N	1	ไกรวุฒิ	\N	นิ่มนวล	1	1	0	0	9	ถนนเจริญกรุง	\N	\N	5705	2558	421	1	3.67	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	3	10010007	6-5336-93351-34-5	\N	2	สุดารัตน์	\N	ชัยมงคล	2	1	0	0	6	ถนนลาดพร้าว	\N	\N	5705	2566	102	3	2.73	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	7-7450-67323-45-9	\N	1	ธัชพล	\N	สกุลดี	1	1	0	0	2	ถนนบรมราชชนนี	\N	\N	5703	2566	102	2	2.86	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	8-3431-45532-34-1	\N	1	ชาตรี	\N	ใจดี	1	1	0	0	7	ถ.บ้านโป่ง	\N	\N	5702	2561	111	3	3.51	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	4	10010007	1-9080-10399-75-3	\N	2	ศิริพร	\N	เพียรดี	2	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	5704	2557	422	2	3.02	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	2	10010007	2-6823-69559-83-3	\N	1	วสันต์	\N	สุวรรณภูมิ	1	1	0	0	1	ถนนประดิษฐ์มนูธรรม	\N	\N	5701	2558	421	1	3.48	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	7-3686-12117-20-8	\N	1	บุญยิ่ง	\N	พงษ์ไพร	1	1	0	0	3	ถนนห้วยแก้ว	\N	\N	5704	2561	111	1	3.69	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	7-7934-24464-21-1	\N	1	ณัฐวรรธน์	\N	บุญมี	1	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	5704	2561	111	1	3.79	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	8-7407-73361-37-7	\N	1	ณัฐวรรธน์	\N	พงษ์ไพร	1	1	0	0	1	ถนนเจริญกรุง	\N	\N	5705	2564	104	3	3.22	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	1-7408-61254-99-7	\N	2	พรทิพย์	\N	คงมั่น	2	1	0	0	8	ถนนอุดรดุษฎี	\N	\N	5705	2559	113	3	3.94	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	1	10010007	1-6566-16378-96-1	\N	1	สมศักดิ์	\N	ชัยมงคล	1	1	0	0	9	ถนนสาทร	\N	\N	5703	2563	105	3	3.29	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	2	10010007	1-6758-58597-65-5	\N	1	รชานนท์	\N	ยิ้มแย้ม	1	1	0	0	5	ถนนงามวงศ์วาน	\N	\N	5705	2566	102	2	2.57	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	6-1210-33600-86-1	\N	2	ชลธิชา	\N	หอมหวาน	2	1	0	0	8	ถนนสุดสาคร	\N	\N	5702	2567	101	1	3.09	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	1	10010007	5-9791-37589-62-8	\N	1	มานพ	\N	ศรีสุข	1	1	0	0	9	ถนนเยาวราช	\N	\N	5705	2558	421	3	3.8	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	2-2948-72683-65-8	\N	1	ปัณณทัต	\N	บุญมี	1	1	0	0	6	ถนนกลางเมือง	\N	\N	5701	2562	106	2	2.56	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	3	10010007	6-4261-23790-52-8	\N	1	อนุชา	\N	เพียรดี	1	1	0	0	6	ถนนสรงประภา	\N	\N	5701	2560	112	1	3.65	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	7-1586-35930-84-1	\N	1	ทักษิณ	\N	วิไลวรรณ	1	1	0	0	4	ถนนอุดรดุษฎี	\N	\N	5701	2561	111	1	3.68	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	4-6324-19831-50-4	\N	3	วิมลรัตน์	\N	มีสุข	2	1	0	0	5	ถ.บ้านโป่ง	\N	\N	5703	2562	106	2	3.9	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	8-9940-15867-13-4	\N	2	กุลธิดา	\N	กิตติคุณ	2	1	0	0	8	ถนนนวมินทร์	\N	\N	5701	2558	421	1	2.34	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	1-9237-29952-40-5	\N	1	ธนภัทร	\N	ศรีสุข	1	1	0	0	2	ถนนสุดสาคร	\N	\N	5701	2558	421	3	2.29	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	8-9523-80093-55-2	\N	1	ไกรวุฒิ	\N	สุจริต	1	1	0	0	7	ถนนสุดสาคร	\N	\N	5705	2562	106	3	2.93	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	1-5598-39279-85-5	\N	1	สุทธิพงษ์	\N	มณีรัตน์	1	1	0	0	7	ถนนงามวงศ์วาน	\N	\N	5704	2557	422	2	2.62	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	8-3166-66561-23-1	\N	2	นวลจันทร์	\N	บุญมี	2	1	0	0	6	ถนนกาญจนาภิเษก	\N	\N	5702	2567	101	3	3.76	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	1	10010007	5-7754-56622-52-3	\N	1	ดิศรณ์	\N	สีดา	1	1	0	0	2	ถนนเจริญกรุง	\N	\N	5704	2560	112	3	3.7	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	8-5496-56173-34-2	\N	3	นภาพร	\N	หอมหวาน	2	1	0	0	9	ถนนลาดพร้าว	\N	\N	5705	2567	103	1	3.73	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	5-5975-43425-38-4	\N	1	วิชญ์พล	\N	บุญรอด	1	1	0	0	8	ถนนสีลม	\N	\N	5703	2564	104	2	2.94	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	5	10010007	4-8665-89016-49-8	\N	2	นวลจันทร์	\N	นิ่มนวล	2	1	0	0	7	ถนนสาทร	\N	\N	5701	2564	104	2	2.99	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	3	10010007	1-1213-30768-46-3	\N	1	คุณากร	\N	วังขวา	1	1	0	0	8	ถนนนวมินทร์	\N	\N	5702	2563	105	1	3.42	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	1	10010007	3-2824-65902-72-7	\N	2	รัตนาภรณ์	\N	พันธุ์ดี	2	1	0	0	1	ถนนเจริญกรุง	\N	\N	5704	2567	101	2	2.6	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	8-9225-98824-30-5	\N	2	ปัณฑิตา	\N	มณีรัตน์	2	1	0	0	3	ถนนกลางเมือง	\N	\N	5704	2566	102	2	3.26	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	2	10010007	5-1680-92307-94-5	\N	2	ทิพย์สุดา	\N	งามดี	2	1	0	0	5	ถนนช้างเผือก	\N	\N	5705	2558	421	3	3.64	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	4-5157-59415-59-1	\N	1	อนุชา	\N	อินทร์ชัย	1	1	0	0	9	ถนนรามคำแหง	\N	\N	5705	2557	422	2	2.39	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	6-4688-34026-97-9	\N	3	วิมลรัตน์	\N	ทองดี	2	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	5702	2562	106	3	2.81	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	1	10010007	2-1695-48205-77-8	\N	2	รุ่งอรุณ	\N	มณีรัตน์	2	1	0	0	9	ถนนอุดรดุษฎี	\N	\N	5704	2560	112	2	3.78	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	4-4911-46326-50-2	\N	1	วรากร	\N	สุวรรณภูมิ	1	1	0	0	3	ถนนเจริญกรุง	\N	\N	5701	2558	421	3	3.53	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	3	10010007	4-4265-75034-81-9	\N	1	ไกรวุฒิ	\N	อ่อนน้อม	1	1	0	0	2	ถนนนิมมานเหมินท์	\N	\N	5703	2563	105	2	3.51	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	1	10010007	5-4643-78991-27-1	\N	3	ประภา	\N	รักษ์ไทย	2	1	0	0	4	ถนนมิตรภาพ	\N	\N	5703	2566	102	2	3.7	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	4	10010007	8-6454-53784-10-1	\N	1	ชัยชนะ	\N	วังขวา	1	1	0	0	6	ถนนอ่อนนุช	\N	\N	5701	2561	111	3	2.97	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	4-4559-60993-18-5	\N	3	กาญจนา	\N	วังขวา	2	1	0	0	3	ถนนเยาวราช	\N	\N	5701	2556	423	2	3.72	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	6-8155-64492-18-5	\N	2	อภิญญา	\N	สุวรรณภูมิ	2	1	0	0	9	ถนนราษฎร์บูรณะ	\N	\N	5701	2560	112	3	2.45	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	5	10010007	3-8366-99284-56-8	\N	2	นวลจันทร์	\N	รุ่งเรือง	2	1	0	0	8	ถนนอ่อนนุช	\N	\N	5703	2566	102	2	2.61	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	8-5176-21268-86-7	\N	1	ทัศนัย	\N	เจริญชัย	1	1	0	0	5	ถนนสุขุมวิท	\N	\N	5701	2566	102	2	2.54	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	4-6407-88710-93-7	\N	1	ณัฐพล	\N	ปัญญาดี	1	1	0	0	3	ถ.ประชาสามัคคี	\N	\N	5705	2567	101	2	3.12	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	6-5271-10019-27-4	\N	1	วสันต์	\N	พรสวรรค์	1	1	0	0	5	ถ.เอกชัย	\N	\N	5705	2563	105	2	2.96	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	1-3092-79691-92-3	\N	1	ศิวกร	\N	สุวรรณภูมิ	1	1	0	0	7	ถนนมิตรภาพ	\N	\N	5701	2560	112	2	2.55	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	4	10010007	3-8442-58474-42-6	\N	2	เกวลิน	\N	ดำรงค์	2	1	0	0	5	ถนนพหลโยธิน	\N	\N	5702	2557	422	2	2.72	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	5	10010007	8-6918-91287-55-6	\N	1	ชูเกียรติ	\N	ขาวสะอาด	1	1	0	0	4	ถนนสุดสาคร	\N	\N	5705	2562	106	3	2.49	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	6-5211-44074-73-7	\N	2	สมหญิง	\N	สมบูรณ์	2	1	0	0	6	ถนนโชคชัย	\N	\N	5701	2561	111	2	2.99	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	8-7309-89518-31-8	\N	1	ทักษิณ	\N	เพียรดี	1	1	0	0	1	ถนนกาญจนาภิเษก	\N	\N	5701	2563	105	3	3.46	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	6-9482-40584-44-5	\N	1	ธนพัฒน์	\N	บุญรอด	1	1	0	0	4	ถนนสุขุมวิท	\N	\N	5703	2564	104	3	3.01	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	2	10010007	5-3895-46739-17-3	\N	1	มานพ	\N	นิ่มนวล	1	1	0	0	10	ถนนเยาวราช	\N	\N	5704	2560	112	3	2.64	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	5	10010007	1-9835-69163-61-4	\N	1	พิพัฒน์	\N	สุดสวย	1	1	0	0	5	ถนนศรีนครินทร์	\N	\N	5704	2556	423	3	2.77	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	8-4170-72970-78-2	\N	3	รัตนาภรณ์	\N	มีสุข	2	1	0	0	6	ถนนมาลัยแมน	\N	\N	5704	2561	111	1	2.83	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	4	10010007	8-2405-40742-77-8	\N	1	ธัชพล	\N	เพ็งพา	1	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	5701	2563	105	1	2.76	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	2-7950-32231-49-7	\N	2	ณัฐนิชา	\N	ใจดี	2	1	0	0	10	ถนนนวมินทร์	\N	\N	5705	2566	102	2	3.14	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	5	10010007	8-3971-26509-42-8	\N	3	กาญจนา	\N	สมบูรณ์	2	1	0	0	7	ถนนประดิษฐ์มนูธรรม	\N	\N	5701	2567	101	1	2.77	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	1	10010007	2-5385-78001-95-6	\N	2	ลลิตา	\N	สุจริต	2	1	0	0	8	ถนนชัยพฤกษ์	\N	\N	5704	2567	101	2	3.76	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	2	10010007	1-1424-91294-34-5	\N	3	พรรษา	\N	สุดสวย	2	1	0	0	2	ถนนสีลม	\N	\N	5702	2560	112	2	3.99	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	2	10010007	2-2072-55332-50-9	\N	3	นลินทิพย์	\N	ชัยมงคล	2	1	0	0	3	ถนนศรีนครินทร์	\N	\N	5703	2557	422	2	2.96	10	เชียงราย	เมืองเชียงราย	บ้านดู่
2569	1	3	10010007	1-8388-13409-65-8	\N	1	นพรัตน์	\N	ศรีสุข	1	1	0	0	8	ถนนอุดรดุษฎี	\N	\N	5705	2556	423	1	2.89	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	4-4164-62461-47-3	\N	1	รัฐนนท์	\N	คงมั่น	1	1	0	0	6	ถนนห้วยแก้ว	\N	\N	5701	2557	422	2	2.63	10	เชียงราย	เมืองเชียงราย	เวียง
2569	1	2	10010007	3-2450-14333-22-3	\N	1	วิชญ์พล	\N	เกียรติสกุล	1	1	0	0	6	ถนนนิมมานเหมินท์	\N	\N	5702	2566	102	3	3.88	10	เชียงราย	เมืองเชียงราย	รอบเวียง
2569	1	1	10010007	6-8356-71764-15-4	\N	3	ลลิตา	\N	สง่างาม	2	1	0	0	2	ถ.เอกชัย	\N	\N	5705	2567	103	2	3.24	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	2	10010007	3-1673-18778-44-4	\N	1	ประพันธ์	\N	สกุลดี	1	1	0	0	6	ถนนนิมมานเหมินท์	\N	\N	5705	2564	104	2	3.19	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	4	10010007	4-8158-75608-65-4	\N	2	นภาพร	\N	ธนาคาร	2	1	0	0	7	ถนนนิมมานเหมินท์	\N	\N	5704	2562	106	3	3.02	10	เชียงราย	เมืองเชียงราย	นางแล
2569	1	1	10010007	4-3167-64068-67-4	\N	3	สุมาลี	\N	ชูศรี	2	1	0	0	10	ถนนสรงประภา	\N	\N	5705	2562	106	1	3.32	10	เชียงราย	เมืองเชียงราย	แม่กรณ์
2569	1	3	10010008	5-5043-92171-50-3	\N	3	กัญญาณัฐ	\N	ชูศรี	2	1	0	0	3	ถนนเพชรเกษม	\N	\N	7303	2567	101	1	3.43	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	8-3811-84255-78-1	\N	2	กุลธิดา	\N	ศักดิ์สิทธิ์	2	1	0	0	3	ถนนสุขุมวิท	\N	\N	7303	2559	113	2	3.55	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	2-4997-44432-28-1	\N	1	ทักษิณ	\N	ใจดี	1	1	0	0	5	ถนนช้างเผือก	\N	\N	7304	2560	112	2	2.63	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	7-3247-58873-39-1	\N	2	ปิยนุช	\N	พงษ์ไพร	2	1	0	0	4	ถนนรัตนาธิเบศร์	\N	\N	7301	2567	103	2	3.93	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	2-4455-18639-46-7	\N	1	กันตภณ	\N	มงคล	1	1	0	0	5	ถนนนิมมานเหมินท์	\N	\N	7301	2560	112	1	2.03	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	1-7083-54016-94-3	\N	1	ศุภณัฐ	\N	พันธุ์ดี	1	1	0	0	3	ถ.เอกชัย	\N	\N	7302	2567	103	3	3.06	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	8-9489-68966-99-3	\N	2	ณัฐนิชา	\N	สกุลดี	2	1	0	0	6	ถนนสุดสาคร	\N	\N	7301	2560	112	3	2.93	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	8-8118-48005-89-7	\N	3	นวลจันทร์	\N	ใจดี	2	1	0	0	8	ถนนราษฎร์บูรณะ	\N	\N	7301	2562	106	2	2.03	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	1-8256-24835-23-5	\N	3	จันทร์เพ็ญ	\N	ดีสมัย	2	1	0	0	8	ถนนห้วยแก้ว	\N	\N	7302	2564	104	2	3.11	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	2-3359-73384-11-5	\N	1	บุญยิ่ง	\N	สง่างาม	1	1	0	0	3	ถนนสรงประภา	\N	\N	7303	2567	103	1	2.28	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	5-4805-37812-24-7	\N	2	ดรุณี	\N	พงษ์ไพร	2	1	0	0	2	ถนนอุดรดุษฎี	\N	\N	7302	2564	104	3	2.35	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	8-2875-24680-87-9	\N	3	วันวิสา	\N	ขาวสะอาด	2	1	0	0	10	ถนนช้างเผือก	\N	\N	7303	2558	421	3	2.97	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	3-4930-86401-17-4	\N	1	รัฐนนท์	\N	ศรีสุข	1	1	0	0	8	ถนนรามคำแหง	\N	\N	7303	2567	101	3	3.85	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	3-4444-62849-32-5	\N	3	นวลจันทร์	\N	พรประเสริฐ	2	1	0	0	6	ถนนโชคชัย	\N	\N	7304	2560	112	1	2.8	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	8-9140-55402-13-9	\N	3	จันทร์เพ็ญ	\N	ทั่วถึง	2	1	0	0	1	ถนนมิตรภาพ	\N	\N	7302	2559	113	1	3.62	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	5-1804-17922-29-8	\N	2	สมหญิง	\N	ใจดี	2	1	0	0	5	ถนนโชคชัย	\N	\N	7304	2559	113	2	3.26	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	7-7385-66068-16-5	\N	3	รัตนาภรณ์	\N	ขาวสะอาด	2	1	0	0	5	ถนนนวมินทร์	\N	\N	7302	2560	112	3	3.65	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	2-9619-32124-72-8	\N	3	วันวิสา	\N	ศรีสุข	2	1	0	0	4	ถนนวิภาวดีรังสิต	\N	\N	7301	2558	421	3	2.15	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	6-3054-70661-40-4	\N	3	พรรษา	\N	ชูศรี	2	1	0	0	2	ถนนเจริญกรุง	\N	\N	7304	2556	423	3	3.48	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	4-6490-46344-90-6	\N	1	ณัฐวุฒิ	\N	รุ่งเรือง	1	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	7304	2557	422	2	2.24	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	8-1905-50467-90-6	\N	2	สมหญิง	\N	สีดา	2	1	0	0	6	ถนนสาทร	\N	\N	7304	2564	104	3	2.31	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	5-2709-29838-70-3	\N	1	ภูมิพัฒน์	\N	ใจดี	1	1	0	0	6	ถนนศรีนครินทร์	\N	\N	7304	2563	105	1	3.55	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	5-1856-58067-56-6	\N	1	วสันต์	\N	สมบูรณ์	1	1	0	0	3	ถนนห้วยแก้ว	\N	\N	7303	2560	112	2	3.38	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	3-7611-50374-29-5	\N	1	วุฒิพงษ์	\N	ลือชา	1	1	0	0	4	ถ.ประชาสามัคคี	\N	\N	7303	2558	421	2	2.86	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	5-2193-10462-63-5	\N	2	นันทพร	\N	ธนาคาร	2	1	0	0	10	ถนนสุดสาคร	\N	\N	7302	2566	102	1	2.69	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	2-5564-77311-69-7	\N	1	เจษฎา	\N	เพ็งพา	1	1	0	0	1	ถนนมาลัยแมน	\N	\N	7304	2562	106	1	3.43	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	3-2920-85097-53-7	\N	3	พรทิพย์	\N	เพ็งพา	2	1	0	0	10	ถนนอ่อนนุช	\N	\N	7303	2564	104	1	3.23	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	7-7361-92361-24-6	\N	1	ณัฐพล	\N	เกียรติสกุล	1	1	0	0	9	ถนนเจริญกรุง	\N	\N	7301	2567	101	3	3.02	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	7-3355-42106-33-2	\N	3	ศิริพร	\N	ทั่วถึง	2	1	0	0	6	ถนนรามคำแหง	\N	\N	7301	2564	104	1	3.91	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	7-1449-54213-76-7	\N	2	ชนิดา	\N	คงพิทักษ์	2	1	0	0	6	ถนนสีลม	\N	\N	7304	2561	111	3	3.63	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	8-1764-47591-37-2	\N	1	กันตภณ	\N	สุจริต	1	1	0	0	1	ถ.รัฐพัฒนา	\N	\N	7302	2563	105	1	2.36	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	6-9301-84240-34-7	\N	2	รัตนาภรณ์	\N	รักษ์ไทย	2	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	7304	2566	102	3	3.9	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	7-8719-97514-77-8	\N	1	ปิยังกูร	\N	สีดา	1	1	0	0	4	ถนนโชคชัย	\N	\N	7304	2566	102	1	3.23	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	3-3464-37246-77-4	\N	1	รัฐนนท์	\N	จันทร์แก้ว	1	1	0	0	6	ถนนราษฎร์บูรณะ	\N	\N	7301	2557	422	1	3.31	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	1-7513-95588-40-3	\N	1	นรวิชญ์	\N	บริบูรณ์	1	1	0	0	5	ถนนกาญจนาภิเษก	\N	\N	7304	2562	106	1	2.54	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	3-7850-23740-60-6	\N	3	กัญญา	\N	รุ่งเรือง	2	1	0	0	6	ถนนนิมมานเหมินท์	\N	\N	7301	2567	101	1	3.89	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	8-1912-27337-25-5	\N	1	เจษฎา	\N	ชูศรี	1	1	0	0	7	ถนนงามวงศ์วาน	\N	\N	7302	2563	105	3	3.18	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	7-7008-44542-47-2	\N	2	เพ็ญพักตร์	\N	ขาวสะอาด	2	1	0	0	10	ถนนลาดพร้าว	\N	\N	7304	2563	105	1	2.1	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	8-1538-53273-11-4	\N	3	กุลธิดา	\N	บริบูรณ์	2	1	0	0	6	ถนนมาลัยแมน	\N	\N	7301	2567	101	3	3.49	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	6-7508-11259-47-9	\N	1	ปัณณทัต	\N	มีสุข	1	1	0	0	6	ถนนบรมราชชนนี	\N	\N	7302	2561	111	2	3.4	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	4-3882-34397-96-7	\N	1	มานพ	\N	ชูศรี	1	1	0	0	8	ถนนงามวงศ์วาน	\N	\N	7301	2562	106	2	3.51	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	6-3807-99334-68-3	\N	1	วรากร	\N	ปัญญาดี	1	1	0	0	10	ถนนงามวงศ์วาน	\N	\N	7304	2556	423	2	2.23	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	6-5042-81602-42-2	\N	3	จิตรลดา	\N	บุญมี	2	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	7302	2563	105	3	2.28	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	3-3619-97803-43-6	\N	3	กาญจนา	\N	วงษ์สุวรรณ	2	1	0	0	9	ถนนเจริญกรุง	\N	\N	7304	2563	105	2	3.36	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	4-5630-16245-75-4	\N	1	ภัคพล	\N	สกุลดี	1	1	0	0	4	ถ.เอกชัย	\N	\N	7301	2557	422	3	3.12	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	7-7793-78478-61-7	\N	1	ธัชพล	\N	มงคล	1	1	0	0	9	ถนนสุขุมวิท	\N	\N	7301	2559	113	3	3.15	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	1-1810-34433-28-8	\N	1	สุรชัย	\N	ชูศรี	1	1	0	0	6	ถนนพหลโยธิน	\N	\N	7303	2559	113	2	2.48	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	3-1584-40783-38-8	\N	1	อนุชา	\N	รุ่งเรือง	1	1	0	0	2	ถนนเยาวราช	\N	\N	7301	2566	102	2	3.81	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	3-9172-84545-39-3	\N	1	ณัฐวรรธน์	\N	ศรีสุข	1	1	0	0	3	ถนนมาลัยแมน	\N	\N	7302	2558	421	2	2.9	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	3-5036-42315-60-9	\N	3	ดรุณี	\N	หอมหวาน	2	1	0	0	4	ถนนชัยพฤกษ์	\N	\N	7302	2561	111	2	3.53	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	2-7823-19870-95-9	\N	3	ณัฐนิชา	\N	สมบูรณ์	2	1	0	0	1	ถนนโชคชัย	\N	\N	7301	2560	112	2	3.22	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	4-7455-33199-66-3	\N	1	ไกรวุฒิ	\N	บุญรอด	1	1	0	0	5	ถนนนิมมานเหมินท์	\N	\N	7301	2566	102	1	3.44	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	8-4810-27544-98-8	\N	2	อรณิชา	\N	ลือชา	2	1	0	0	3	ถนนศรีนครินทร์	\N	\N	7303	2567	101	2	2.7	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	1-2578-61426-89-4	\N	1	ชนะชัย	\N	พรสวรรค์	1	1	0	0	3	ถ.ประชาสามัคคี	\N	\N	7303	2564	104	1	2.46	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	2-7915-10552-79-7	\N	2	ทิพย์สุดา	\N	วงษ์สุวรรณ	2	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	7304	2564	104	3	3.98	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	6-8606-52428-29-7	\N	2	ภัทรวดี	\N	ดีสมัย	2	1	0	0	7	ถนนนิมมานเหมินท์	\N	\N	7304	2559	113	3	2.01	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	8-3540-35337-83-2	\N	2	ชลธิชา	\N	วิริยะ	2	1	0	0	10	ถนนบรมราชชนนี	\N	\N	7301	2567	103	1	3.39	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	6-2037-59573-68-7	\N	3	จิราพร	\N	เกียรติสกุล	2	1	0	0	6	ถนนมิตรภาพ	\N	\N	7301	2567	101	1	3.15	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	3-3259-35862-58-5	\N	1	ไกรวุฒิ	\N	เจริญชัย	1	1	0	0	5	ถนนมิตรภาพ	\N	\N	7304	2566	102	2	3.11	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	5-3540-48896-87-2	\N	1	ศิวกร	\N	พงษ์ไพร	1	1	0	0	7	ถนนชัยพฤกษ์	\N	\N	7304	2562	106	3	2.54	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	5-3423-33737-28-2	\N	2	กุลธิดา	\N	กิตติคุณ	2	1	0	0	3	ถนนนิมมานเหมินท์	\N	\N	7304	2567	103	2	3.47	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	1-4810-43734-66-4	\N	1	ชัยชนะ	\N	จันทร์แก้ว	1	1	0	0	2	ถ.รัฐพัฒนา	\N	\N	7304	2562	106	3	2.19	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	6-1241-76337-36-4	\N	2	ภัทรวดี	\N	เพียรดี	2	1	0	0	3	ถ.เอกชัย	\N	\N	7302	2567	103	2	3.17	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	2-4564-51658-93-7	\N	1	ภูมิพัฒน์	\N	ขาวสะอาด	1	1	0	0	4	ถนนวิภาวดีรังสิต	\N	\N	7303	2564	104	3	3.92	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	2-7237-40177-35-6	\N	1	วรากร	\N	สุดสวย	1	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	7304	2556	423	3	3.35	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	3-6302-49674-23-8	\N	1	อนุชา	\N	สุวรรณภูมิ	1	1	0	0	7	ถนนนวมินทร์	\N	\N	7303	2560	112	1	3.87	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	3-5173-54694-80-1	\N	1	อนุชา	\N	สุจริต	1	1	0	0	3	ถนนโชคชัย	\N	\N	7302	2566	102	2	3.88	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	2-7999-33068-57-5	\N	3	มณีรัตน์	\N	ศรีสุข	2	1	0	0	10	ถนนอ่อนนุช	\N	\N	7304	2560	112	3	3.96	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	4-9475-66835-24-4	\N	1	พิพัฒน์	\N	วิไลวรรณ	1	1	0	0	7	ถ.รัฐพัฒนา	\N	\N	7302	2556	423	2	2.2	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	4-4711-69333-97-1	\N	2	นภาพร	\N	สกุลดี	2	1	0	0	8	ถนนสุรวงศ์	\N	\N	7301	2557	422	1	2.64	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	6-4921-20237-32-2	\N	2	กาญจนา	\N	บุญมี	2	1	0	0	8	ถนนเจริญกรุง	\N	\N	7304	2562	106	2	2.01	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	3-1862-45763-21-9	\N	3	พิมพ์ชนก	\N	นิ่มนวล	2	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	7304	2557	422	3	2.85	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	8-6136-83164-59-5	\N	1	วรากร	\N	นิ่มนวล	1	1	0	0	8	ถนนเยาวราช	\N	\N	7301	2567	101	2	3.33	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	2-8422-53892-51-1	\N	1	ชูเกียรติ	\N	ศรีสุข	1	1	0	0	5	ถนนสุดสาคร	\N	\N	7302	2566	102	2	2.87	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	5-1800-39713-87-8	\N	1	ภัคพล	\N	ศรีสุข	1	1	0	0	3	ถนนบายพาส	\N	\N	7303	2567	103	3	3.72	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	5-2458-43816-26-6	\N	3	เกวลิน	\N	สุวรรณภูมิ	2	1	0	0	1	ถนนมิตรภาพ	\N	\N	7304	2563	105	3	3.26	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	6-3629-76465-76-3	\N	3	กุลธิดา	\N	สุจริต	2	1	0	0	4	ถนนรามคำแหง	\N	\N	7301	2564	104	3	2.79	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	5-4320-57046-78-6	\N	1	อภิวัฒน์	\N	นิ่มนวล	1	1	0	0	10	ถนนเพชรเกษม	\N	\N	7304	2560	112	3	2.43	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	3-3322-53791-92-5	\N	3	พรรษา	\N	พงษ์ไพร	2	1	0	0	4	ถ.บ้านโป่ง	\N	\N	7303	2564	104	2	3.47	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	8-2898-67307-57-4	\N	3	กุลธิดา	\N	ประสิทธิ์ผล	2	1	0	0	6	ถนนช้างเผือก	\N	\N	7302	2561	111	2	2.37	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	6-9233-96156-26-5	\N	3	กุลธิดา	\N	เกียรติสกุล	2	1	0	0	9	ถนนมาลัยแมน	\N	\N	7301	2556	423	3	3.14	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	5-2989-68546-84-4	\N	1	ณัฐพล	\N	คงพิทักษ์	1	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	7304	2563	105	3	2.67	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	6-5135-50635-14-7	\N	1	ศุภณัฐ	\N	ขาวสะอาด	1	1	0	0	8	ถนนบายพาส	\N	\N	7301	2562	106	1	3.82	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	1-7062-30825-95-8	\N	1	พิพัฒน์	\N	รักษ์ไทย	1	1	0	0	8	ถนนสุขุมวิท	\N	\N	7303	2563	105	2	2.07	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	4-1819-69346-94-8	\N	1	ประพันธ์	\N	หอมหวาน	1	1	0	0	10	ถ.บ้านโป่ง	\N	\N	7304	2560	112	2	3.87	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	2-5635-13029-72-3	\N	2	ชลธิชา	\N	ชูศรี	2	1	0	0	4	ถนนกาญจนาภิเษก	\N	\N	7301	2558	421	3	3.31	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	2-9176-16536-75-3	\N	3	ภัทรวดี	\N	สีดา	2	1	0	0	10	ถนนชัยพฤกษ์	\N	\N	7301	2559	113	1	3.42	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	4-1464-10573-32-6	\N	1	ณัฐพล	\N	ชูศรี	1	1	0	0	1	ถนนงามวงศ์วาน	\N	\N	7302	2558	421	1	3.51	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	1-6692-58515-51-3	\N	1	พิพัฒน์	\N	มีสุข	1	1	0	0	4	ถ.เอกชัย	\N	\N	7303	2557	422	1	3.23	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	8-6651-72926-99-5	\N	1	อนุชา	\N	นิ่มนวล	1	1	0	0	6	ถนนบายพาส	\N	\N	7301	2556	423	3	3.92	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	4-9913-50309-63-6	\N	2	วิมลรัตน์	\N	ปัญญาดี	2	1	0	0	2	ถนนลาดพร้าว	\N	\N	7304	2557	422	1	2.42	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	2-4415-15392-25-7	\N	1	สมศักดิ์	\N	พันธุ์ดี	1	1	0	0	1	ถนนสุดสาคร	\N	\N	7302	2561	111	3	2.45	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	4-5762-25565-72-8	\N	3	รุ่งอรุณ	\N	พรสวรรค์	2	1	0	0	4	ถนนสาทร	\N	\N	7301	2566	102	2	3.46	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	3-2636-91992-78-3	\N	2	จันทร์เพ็ญ	\N	งามดี	2	1	0	0	2	ถนนบายพาส	\N	\N	7301	2562	106	1	3.09	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	2-9652-59310-69-9	\N	1	ภัคพล	\N	เพียรดี	1	1	0	0	2	ถนนบรมราชชนนี	\N	\N	7302	2561	111	1	3.93	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	4-7539-85653-97-8	\N	1	ปิยังกูร	\N	พรสวรรค์	1	1	0	0	1	ถนนสรงประภา	\N	\N	7301	2560	112	1	3.84	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	2-2138-89393-93-4	\N	3	ลลิตา	\N	พงษ์ไพร	2	1	0	0	6	ถนนวิภาวดีรังสิต	\N	\N	7303	2557	422	2	2.54	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	7-3663-50129-12-3	\N	2	ดวงใจ	\N	พรประเสริฐ	2	1	0	0	4	ถนนโชคชัย	\N	\N	7304	2558	421	3	3.96	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	2-5281-52044-11-1	\N	2	เพ็ญพักตร์	\N	แสงสว่าง	2	1	0	0	10	ถนนสุขุมวิท	\N	\N	7302	2563	105	2	3.27	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	7-4957-90591-53-4	\N	1	ทักษิณ	\N	สุจริต	1	1	0	0	10	ถนนบรมราชชนนี	\N	\N	7303	2563	105	1	3.04	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	3-8285-60331-50-4	\N	1	วีรชัย	\N	มงคล	1	1	0	0	5	ถนนนวมินทร์	\N	\N	7304	2560	112	1	2.43	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	3-4857-83051-56-9	\N	1	ธนาธิป	\N	สุดสวย	1	1	0	0	6	ถนนช้างเผือก	\N	\N	7303	2563	105	2	2.78	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	6-6080-49680-49-9	\N	1	ภูมิพัฒน์	\N	ใจดี	1	1	0	0	5	ถ.บ้านโป่ง	\N	\N	7301	2566	102	3	3.55	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	1	10010008	8-1228-34743-96-3	\N	1	ธนภัทร	\N	มีสุข	1	1	0	0	3	ถนนเพชรเกษม	\N	\N	7303	2567	101	2	2.66	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	4-2219-13414-36-3	\N	3	พรรษา	\N	นิ่มนวล	2	1	0	0	1	ถนนกาญจนาภิเษก	\N	\N	7301	2562	106	2	3.55	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	2-1897-29684-86-8	\N	1	วรพล	\N	แสงสว่าง	1	1	0	0	3	ถนนช้างเผือก	\N	\N	7302	2564	104	1	3.11	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	1-9091-89593-64-4	\N	3	ชนิดา	\N	ศรีสุข	2	1	0	0	4	ถนนสุขุมวิท	\N	\N	7302	2557	422	1	2.93	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	3-2934-31526-72-5	\N	1	ดิศรณ์	\N	สุวรรณภูมิ	1	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	7301	2556	423	2	2.86	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	6-3901-93753-89-6	\N	1	นรวิชญ์	\N	คงมั่น	1	1	0	0	7	ถนนมิตรภาพ	\N	\N	7303	2557	422	3	3.78	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	1-5979-48927-19-5	\N	2	รัตนาภรณ์	\N	ชูศรี	2	1	0	0	8	ถนนกลางเมือง	\N	\N	7302	2563	105	3	2.65	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	3-6715-64712-47-9	\N	1	ทัศนัย	\N	มีสุข	1	1	0	0	6	ถนนนวมินทร์	\N	\N	7304	2567	103	2	3.57	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	6-9137-73714-10-6	\N	3	สุดารัตน์	\N	สกุลดี	2	1	0	0	2	ถนนประดิษฐ์มนูธรรม	\N	\N	7304	2566	102	2	3.85	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	7-5588-54185-18-2	\N	2	ทิพย์สุดา	\N	ประสิทธิ์ผล	2	1	0	0	6	ถนนพหลโยธิน	\N	\N	7304	2560	112	3	3.55	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	5-3714-65672-43-7	\N	2	เพ็ญพักตร์	\N	สุขสันต์	2	1	0	0	10	ถ.บ้านโป่ง	\N	\N	7303	2566	102	3	3.18	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	7-4610-76482-33-9	\N	2	ปัณฑิตา	\N	ธนาคาร	2	1	0	0	6	ถนนลาดพร้าว	\N	\N	7303	2559	113	2	3.68	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	3-1452-93807-88-3	\N	3	ภัทรวดี	\N	รักษ์ไทย	2	1	0	0	3	ถนนช้างเผือก	\N	\N	7304	2560	112	1	3.72	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	5-5349-60102-27-8	\N	1	รัฐนนท์	\N	สมบูรณ์	1	1	0	0	7	ถนนสุรวงศ์	\N	\N	7302	2557	422	1	2.35	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	2-6162-97866-22-3	\N	2	สุมาลี	\N	พันธุ์ดี	2	1	0	0	10	ถนนช้างเผือก	\N	\N	7304	2556	423	3	3.71	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	4-6431-75565-94-5	\N	2	ทิพย์สุดา	\N	สีดา	2	1	0	0	10	ถนนงามวงศ์วาน	\N	\N	7303	2559	113	3	3.98	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	3-8757-95495-96-6	\N	3	มาลัย	\N	อินทร์ชัย	2	1	0	0	2	ถนนสรงประภา	\N	\N	7303	2560	112	3	2.68	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	5-8495-42693-18-2	\N	1	สุทธิพงษ์	\N	สุดสวย	1	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	7301	2567	101	3	2.63	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	2-1881-51223-95-1	\N	2	นลินทิพย์	\N	สกุลดี	2	1	0	0	5	ถนนห้วยแก้ว	\N	\N	7301	2558	421	3	3.22	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	6-9040-58106-76-4	\N	2	สมหญิง	\N	นิ่มนวล	2	1	0	0	5	ถนนวิภาวดีรังสิต	\N	\N	7304	2561	111	1	2.25	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	1-9338-48588-21-9	\N	3	จิตรลดา	\N	เพ็งพา	2	1	0	0	3	ถนนนวมินทร์	\N	\N	7301	2560	112	3	2.6	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	6-6389-14565-57-5	\N	3	ชนิดา	\N	ดำรงค์	2	1	0	0	2	ถนนช้างเผือก	\N	\N	7301	2566	102	3	3.16	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	8-1036-68040-84-7	\N	1	ไกรวุฒิ	\N	แสงสว่าง	1	1	0	0	1	ถนนสุดสาคร	\N	\N	7302	2560	112	2	3.67	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	1	10010008	2-3815-81037-43-9	\N	1	บุญยิ่ง	\N	สกุลดี	1	1	0	0	4	ถนนบายพาส	\N	\N	7303	2558	421	1	3.52	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	7-3152-27886-63-2	\N	3	ทิพย์สุดา	\N	บุญรอด	2	1	0	0	6	ถนนบายพาส	\N	\N	7302	2564	104	2	3.53	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	7-3038-12547-11-3	\N	2	จิตรลดา	\N	สกุลดี	2	1	0	0	4	ถนนมิตรภาพ	\N	\N	7301	2561	111	3	2.52	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	7-2796-53821-70-4	\N	1	บุญยิ่ง	\N	บุญมี	1	1	0	0	5	ถนนเยาวราช	\N	\N	7301	2557	422	2	2.73	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	5-2393-41816-79-8	\N	1	นพรัตน์	\N	สุวรรณภูมิ	1	1	0	0	9	ถ.บ้านโป่ง	\N	\N	7304	2556	423	1	2.95	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	4-8753-89967-51-3	\N	1	รัฐนนท์	\N	ศักดิ์สิทธิ์	1	1	0	0	4	ถนนอ่อนนุช	\N	\N	7301	2559	113	1	3.44	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	8-1204-97708-69-2	\N	1	กันตภณ	\N	พงษ์ไพร	1	1	0	0	3	ถ.บ้านโป่ง	\N	\N	7302	2558	421	1	3.26	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	1-9399-18990-34-3	\N	3	จิตรลดา	\N	พงษ์ไพร	2	1	0	0	3	ถนนรัตนาธิเบศร์	\N	\N	7302	2566	102	2	3.64	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	4-6211-24708-87-8	\N	1	ธนาธิป	\N	แสงสว่าง	1	1	0	0	9	ถนนประดิษฐ์มนูธรรม	\N	\N	7303	2567	103	3	2.73	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	1-5766-28511-95-6	\N	1	รชานนท์	\N	หอมหวาน	1	1	0	0	10	ถนนสุขุมวิท	\N	\N	7303	2559	113	1	3.61	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	5-2597-75347-15-2	\N	1	สมศักดิ์	\N	ธนาคาร	1	1	0	0	9	ถนนสีลม	\N	\N	7302	2557	422	2	2.33	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	4-1971-54747-95-8	\N	1	ปัณณทัต	\N	กิตติคุณ	1	1	0	0	10	ถนนราษฎร์บูรณะ	\N	\N	7304	2566	102	1	2.89	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	2-4811-63543-74-3	\N	2	จันทร์เพ็ญ	\N	กิตติคุณ	2	1	0	0	3	ถนนรัตนาธิเบศร์	\N	\N	7302	2563	105	1	3.84	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	7-7029-47716-61-3	\N	1	วสันต์	\N	ชัยมงคล	1	1	0	0	2	ถนนบรมราชชนนี	\N	\N	7302	2564	104	3	3.08	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	3-2732-27395-44-1	\N	2	ลลิตา	\N	ยิ้มแย้ม	2	1	0	0	8	ถนนบายพาส	\N	\N	7301	2557	422	1	2.09	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	3-2904-42143-52-1	\N	3	วิมลรัตน์	\N	เพียรดี	2	1	0	0	2	ถนนเพชรเกษม	\N	\N	7302	2567	101	1	3.74	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	6-1443-87319-26-2	\N	1	กันตภณ	\N	หอมหวาน	1	1	0	0	9	ถนนวิภาวดีรังสิต	\N	\N	7304	2563	105	3	3.96	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	5-8638-29231-94-1	\N	3	มณีรัตน์	\N	เพียรดี	2	1	0	0	5	ถ.บ้านโป่ง	\N	\N	7303	2558	421	2	2.28	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	5-1031-44456-59-6	\N	2	สุดารัตน์	\N	สุจริต	2	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	7301	2567	101	2	3.12	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	5-6213-30978-50-3	\N	3	ปาณิสรา	\N	รุ่งเรือง	2	1	0	0	9	ถนนโชคชัย	\N	\N	7303	2567	103	2	3.13	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	1-5096-41225-20-8	\N	3	สุดารัตน์	\N	วิไลวรรณ	2	1	0	0	9	ถนนวิภาวดีรังสิต	\N	\N	7301	2567	103	3	2.61	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	8-6574-44161-77-4	\N	1	วรากร	\N	พงษ์ไพร	1	1	0	0	10	ถนนสาทร	\N	\N	7301	2561	111	2	3.47	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	1	10010008	3-3674-43736-24-3	\N	3	ศิริพร	\N	บุญมี	2	1	0	0	6	ถนนพหลโยธิน	\N	\N	7304	2556	423	2	2.5	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	8-3251-33649-39-8	\N	1	คุณากร	\N	สุจริต	1	1	0	0	3	ถนนลาดพร้าว	\N	\N	7302	2563	105	1	2.37	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	1-1851-66308-40-3	\N	2	สุดารัตน์	\N	คงพิทักษ์	2	1	0	0	4	ถนนประดิษฐ์มนูธรรม	\N	\N	7304	2560	112	1	3.65	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	6-9674-34797-91-8	\N	2	พรรษา	\N	อินทร์ชัย	2	1	0	0	6	ถนนมิตรภาพ	\N	\N	7303	2564	104	1	3.99	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	6-2639-17987-81-9	\N	1	รชานนท์	\N	อินทร์ชัย	1	1	0	0	6	ถนนโชคชัย	\N	\N	7302	2557	422	3	3.21	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	2-9141-83437-40-5	\N	1	คุณากร	\N	ศรีสุข	1	1	0	0	3	ถนนพหลโยธิน	\N	\N	7301	2558	421	3	2.54	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	4-4073-47197-82-8	\N	2	ปาณิสรา	\N	ดีสมัย	2	1	0	0	2	ถ.ประชาสามัคคี	\N	\N	7303	2559	113	1	3.62	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	4-4035-48147-28-5	\N	1	วสันต์	\N	สุขสบาย	1	1	0	0	4	ถนนลาดพร้าว	\N	\N	7303	2559	113	3	3.35	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	4-4629-27534-47-4	\N	1	ทักษิณ	\N	อ่อนน้อม	1	1	0	0	1	ถนนเจริญกรุง	\N	\N	7301	2559	113	1	2.22	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	1-8961-25575-27-2	\N	2	ประภา	\N	ขาวสะอาด	2	1	0	0	3	ถนนกลางเมือง	\N	\N	7303	2556	423	3	2.48	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	2-9243-96382-32-8	\N	3	เพ็ญพักตร์	\N	คงพิทักษ์	2	1	0	0	3	ถนนกาญจนาภิเษก	\N	\N	7301	2564	104	1	2.75	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	2-6827-28788-79-4	\N	3	นวลจันทร์	\N	สมบูรณ์	2	1	0	0	2	ถนนบรมราชชนนี	\N	\N	7301	2561	111	2	3.23	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	1-2746-80105-16-1	\N	3	ศิริพร	\N	จันทร์แก้ว	2	1	0	0	6	ถนนกาญจนาภิเษก	\N	\N	7304	2564	104	2	3.74	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	3-4641-22753-59-3	\N	2	ณัฐนิชา	\N	บริบูรณ์	2	1	0	0	6	ถ.เอกชัย	\N	\N	7304	2560	112	1	2.23	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	6-8724-50927-40-8	\N	2	กัญญาณัฐ	\N	ทองดี	2	1	0	0	4	ถนนประดิษฐ์มนูธรรม	\N	\N	7301	2567	103	2	3.75	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	7-4717-16220-32-2	\N	2	ลลิตา	\N	ทั่วถึง	2	1	0	0	3	ถนนงามวงศ์วาน	\N	\N	7303	2556	423	3	2.15	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	2-2529-28264-86-9	\N	1	ชินดนัย	\N	รุ่งเรือง	1	1	0	0	1	ถนนสาทร	\N	\N	7302	2556	423	1	2.66	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	6-1607-60278-68-5	\N	1	ณัฐพล	\N	รักษ์ไทย	1	1	0	0	9	ถนนศรีนครินทร์	\N	\N	7304	2558	421	1	2.88	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	7-6515-98133-45-8	\N	2	รัตนาภรณ์	\N	ดำรงค์	2	1	0	0	7	ถนนสีลม	\N	\N	7302	2561	111	2	3.73	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	1-4380-60446-53-4	\N	1	ภัคพล	\N	คงพิทักษ์	1	1	0	0	6	ถนนวิภาวดีรังสิต	\N	\N	7301	2558	421	2	2.71	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	7-3059-31936-62-8	\N	1	นรวิชญ์	\N	มีสุข	1	1	0	0	7	ถนนงามวงศ์วาน	\N	\N	7302	2563	105	2	2.85	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	6-3721-28719-47-3	\N	3	สุดารัตน์	\N	ชูศรี	2	1	0	0	1	ถนนกลางเมือง	\N	\N	7301	2563	105	2	3.99	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	7-5453-40069-71-2	\N	2	ปาณิสรา	\N	เกียรติสกุล	2	1	0	0	10	ถนนสุดสาคร	\N	\N	7303	2557	422	2	3.06	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	4-2132-24224-64-1	\N	1	อนุชา	\N	อ่อนน้อม	1	1	0	0	2	ถนนมิตรภาพ	\N	\N	7302	2560	112	3	3.24	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	6-5586-34059-42-1	\N	2	เกวลิน	\N	ดำรงค์	2	1	0	0	2	ถนนมิตรภาพ	\N	\N	7303	2558	421	1	2.19	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	1-9596-64511-80-1	\N	1	ณัฐวรรธน์	\N	ทั่วถึง	1	1	0	0	9	ถนนโชคชัย	\N	\N	7303	2567	103	3	3.04	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	4-7998-44191-51-5	\N	1	ชาตรี	\N	พรประเสริฐ	1	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	7303	2562	106	3	3.29	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	5-3654-92843-84-1	\N	3	ประภา	\N	ดำรงค์	2	1	0	0	5	ถนนสาทร	\N	\N	7304	2558	421	1	2.7	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	8-9650-52965-17-8	\N	2	ปิยนุช	\N	พรสวรรค์	2	1	0	0	9	ถนนอุดรดุษฎี	\N	\N	7304	2558	421	2	3.03	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	1-9901-62960-66-9	\N	3	ธัญชนก	\N	อินทร์ชัย	2	1	0	0	10	ถนนเยาวราช	\N	\N	7301	2567	101	1	3	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	2-3528-70838-53-3	\N	2	ภัทรวดี	\N	มงคล	2	1	0	0	4	ถ.ประชาสามัคคี	\N	\N	7302	2564	104	2	2.94	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	7-4121-51702-19-9	\N	1	ภูมิพัฒน์	\N	สุขสบาย	1	1	0	0	8	ถนนมิตรภาพ	\N	\N	7302	2558	421	2	3.74	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	1	10010008	7-2250-39000-97-1	\N	3	วรรณภา	\N	คงมั่น	2	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	7302	2566	102	3	3.58	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	5-2162-96215-17-4	\N	3	สุนิสา	\N	ธนาคาร	2	1	0	0	7	ถ.บ้านโป่ง	\N	\N	7301	2558	421	2	2.32	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	5-1652-19285-21-8	\N	2	ปิยนุช	\N	เจริญชัย	2	1	0	0	2	ถนนอ่อนนุช	\N	\N	7302	2559	113	3	3.46	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	1	10010008	5-7751-70145-85-1	\N	1	ทัศนัย	\N	พงษ์ไพร	1	1	0	0	9	ถ.รัฐพัฒนา	\N	\N	7304	2567	103	3	3.03	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	3-8330-55224-88-3	\N	2	ดวงใจ	\N	ลือชา	2	1	0	0	8	ถนนนิมมานเหมินท์	\N	\N	7302	2557	422	2	3.6	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	8-8711-48280-16-1	\N	2	วรรณภา	\N	ทองดี	2	1	0	0	10	ถ.รัฐพัฒนา	\N	\N	7301	2560	112	3	3.22	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	7-7246-19351-79-1	\N	1	วรากร	\N	วิริยะ	1	1	0	0	7	ถนนเพชรเกษม	\N	\N	7302	2561	111	2	3.33	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	1-1338-23138-10-3	\N	1	คุณากร	\N	ชัยมงคล	1	1	0	0	3	ถนนสรงประภา	\N	\N	7302	2567	101	1	2.51	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	1-6220-22556-14-2	\N	1	ดิศรณ์	\N	สุดสวย	1	1	0	0	2	ถนนนวมินทร์	\N	\N	7304	2561	111	1	3.77	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	1-7259-70712-65-9	\N	1	วรพล	\N	เจริญชัย	1	1	0	0	8	ถนนงามวงศ์วาน	\N	\N	7302	2566	102	3	3.38	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	1	10010008	7-4758-33523-81-3	\N	1	รัฐนนท์	\N	พันธุ์ดี	1	1	0	0	3	ถนนกลางเมือง	\N	\N	7303	2559	113	1	3.58	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	7-2991-66706-67-3	\N	1	สุทธิพงษ์	\N	เจริญชัย	1	1	0	0	2	ถนนงามวงศ์วาน	\N	\N	7303	2566	102	3	3.91	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	7-6179-52839-14-3	\N	2	ณัฐนิชา	\N	ปัญญาดี	2	1	0	0	5	ถนนราษฎร์บูรณะ	\N	\N	7303	2564	104	2	3.62	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	1-6428-71158-54-6	\N	1	คุณากร	\N	เพียรดี	1	1	0	0	1	ถนนราษฎร์บูรณะ	\N	\N	7302	2557	422	2	3.27	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	6-3939-39772-24-8	\N	3	นันทพร	\N	อ่อนน้อม	2	1	0	0	6	ถนนวิภาวดีรังสิต	\N	\N	7302	2561	111	1	2.64	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	7-2476-37047-88-3	\N	2	ศิริพร	\N	มงคล	2	1	0	0	1	ถนนสุรวงศ์	\N	\N	7302	2557	422	1	2.31	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	8-5588-50268-76-3	\N	1	ชูเกียรติ	\N	พรประเสริฐ	1	1	0	0	3	ถนนโชคชัย	\N	\N	7304	2563	105	2	3.66	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	5-8084-40197-14-7	\N	2	กัญญา	\N	กิตติคุณ	2	1	0	0	7	ถนนสุดสาคร	\N	\N	7302	2559	113	1	2.09	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	1	10010008	7-6109-89946-86-2	\N	3	ประภา	\N	สมบูรณ์	2	1	0	0	1	ถนนเยาวราช	\N	\N	7304	2558	421	3	2.31	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	5-5991-63350-54-8	\N	3	สุภัสสรา	\N	ขาวสะอาด	2	1	0	0	8	ถนนรามคำแหง	\N	\N	7303	2567	101	2	3.46	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	3-8628-75796-84-4	\N	1	อนุชา	\N	ปัญญาดี	1	1	0	0	3	ถนนเจริญกรุง	\N	\N	7304	2558	421	2	2.4	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	6-5211-80031-90-5	\N	2	สิริมา	\N	ธนาคาร	2	1	0	0	3	ถ.บ้านโป่ง	\N	\N	7302	2564	104	2	2.97	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	1-4098-13941-13-3	\N	3	จิตรลดา	\N	สกุลดี	2	1	0	0	2	ถนนนิมมานเหมินท์	\N	\N	7303	2560	112	3	2.55	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	4-3821-38190-27-4	\N	1	วีรชัย	\N	รุ่งเรือง	1	1	0	0	5	ถนนช้างเผือก	\N	\N	7303	2562	106	2	2.72	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	3-9582-88468-63-6	\N	1	นรวิชญ์	\N	สุวรรณภูมิ	1	1	0	0	8	ถนนกลางเมือง	\N	\N	7304	2561	111	3	3.66	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	1-2852-36454-39-8	\N	2	จิตรลดา	\N	เพียรดี	2	1	0	0	7	ถนนงามวงศ์วาน	\N	\N	7301	2567	103	3	3.31	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	5-2460-25099-20-6	\N	1	ประพันธ์	\N	สุจริต	1	1	0	0	9	ถนนเพชรเกษม	\N	\N	7304	2567	103	1	2.38	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	2-2853-56948-79-8	\N	2	นันทพร	\N	ใจดี	2	1	0	0	7	ถนนช้างเผือก	\N	\N	7303	2566	102	3	2.91	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	8-6968-12972-57-8	\N	1	สุทธิพงษ์	\N	สง่างาม	1	1	0	0	10	ถนนสรงประภา	\N	\N	7301	2560	112	1	3.8	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	1-1498-94471-84-5	\N	1	ประพันธ์	\N	ใจดี	1	1	0	0	5	ถนนสีลม	\N	\N	7301	2562	106	3	3.66	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	1-7145-54026-60-5	\N	1	กิตติภณ	\N	บุญมี	1	1	0	0	3	ถ.ประชาสามัคคี	\N	\N	7304	2566	102	1	2.71	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	4-3702-61586-66-7	\N	2	สมหญิง	\N	ศักดิ์สิทธิ์	2	1	0	0	4	ถนนเพชรเกษม	\N	\N	7301	2559	113	1	2.77	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	1	10010008	8-2284-46217-23-5	\N	1	พิพัฒน์	\N	พงษ์ไพร	1	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	7301	2562	106	2	2.68	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	2-5608-36050-74-4	\N	2	อรณิชา	\N	มณีรัตน์	2	1	0	0	9	ถนนงามวงศ์วาน	\N	\N	7304	2560	112	3	2.76	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	6-6089-16699-55-9	\N	3	ศิริพร	\N	วังขวา	2	1	0	0	5	ถ.เอกชัย	\N	\N	7302	2566	102	3	3.39	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	8-3653-95418-49-6	\N	3	นลินทิพย์	\N	กิตติคุณ	2	1	0	0	10	ถ.รัฐพัฒนา	\N	\N	7303	2564	104	3	3.91	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	1-5580-29841-25-1	\N	1	ธนาธิป	\N	พรสวรรค์	1	1	0	0	1	ถนนรามคำแหง	\N	\N	7303	2560	112	2	3.38	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	5-7090-37360-82-1	\N	3	สมหญิง	\N	ศรีสุข	2	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	7301	2556	423	2	3.05	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	4-4881-84254-53-4	\N	2	นภาพร	\N	ทั่วถึง	2	1	0	0	1	ถนนลาดพร้าว	\N	\N	7304	2559	113	1	3.7	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	3-7049-62469-98-4	\N	1	ชัยชนะ	\N	สุวรรณภูมิ	1	1	0	0	8	ถ.บ้านโป่ง	\N	\N	7303	2563	105	3	2.67	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	8-1523-26123-38-2	\N	1	ชนะชัย	\N	สมบูรณ์	1	1	0	0	2	ถนนงามวงศ์วาน	\N	\N	7303	2558	421	2	2.72	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	7-3327-48533-82-3	\N	2	มณีรัตน์	\N	กิตติคุณ	2	1	0	0	2	ถนนช้างเผือก	\N	\N	7302	2563	105	2	3.11	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	8-2145-69979-18-4	\N	1	ชาตรี	\N	สกุลดี	1	1	0	0	6	ถนนสาทร	\N	\N	7303	2556	423	1	3.11	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	3-6419-66782-30-8	\N	2	ดวงใจ	\N	แสงสว่าง	2	1	0	0	4	ถนนอุดรดุษฎี	\N	\N	7303	2561	111	3	3.81	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	1-3313-82009-63-9	\N	2	กุลธิดา	\N	มงคล	2	1	0	0	8	ถนนประดิษฐ์มนูธรรม	\N	\N	7301	2559	113	1	3.53	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	1	10010008	8-3240-16178-98-8	\N	3	นันทพร	\N	ลือชา	2	1	0	0	6	ถนนลาดพร้าว	\N	\N	7303	2564	104	2	2.6	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	7-9486-53205-82-5	\N	2	นภาพร	\N	สุจริต	2	1	0	0	5	ถนนบรมราชชนนี	\N	\N	7302	2562	106	2	3.93	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	1	10010008	6-6114-13733-31-7	\N	2	วิมลรัตน์	\N	คงมั่น	2	1	0	0	3	ถนนเพชรเกษม	\N	\N	7301	2560	112	1	2.64	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	4-7051-26043-80-6	\N	1	ธัชพล	\N	วังขวา	1	1	0	0	3	ถนนชัยพฤกษ์	\N	\N	7301	2556	423	2	2.5	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	1-8212-41516-89-9	\N	1	ภัคพล	\N	ปัญญาดี	1	1	0	0	8	ถนนบรมราชชนนี	\N	\N	7303	2559	113	1	2.4	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	4-1485-10521-69-5	\N	3	วาสนา	\N	สุจริต	2	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	7303	2567	101	2	3.89	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	6-2642-75722-36-2	\N	3	กาญจนา	\N	ศรีสุข	2	1	0	0	7	ถนนสุรวงศ์	\N	\N	7303	2559	113	3	3.65	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	4-1651-53583-68-6	\N	1	ทัศนัย	\N	สมบูรณ์	1	1	0	0	8	ถนนโชคชัย	\N	\N	7303	2560	112	1	3.41	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	7-8007-65935-15-7	\N	2	จิราพร	\N	บริบูรณ์	2	1	0	0	10	ถนนมิตรภาพ	\N	\N	7301	2567	101	2	2.53	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	7-9403-90777-62-6	\N	1	ธนพัฒน์	\N	เกียรติสกุล	1	1	0	0	6	ถนนสาทร	\N	\N	7302	2556	423	1	3.9	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	5-2050-33676-96-5	\N	1	วีรชัย	\N	งามดี	1	1	0	0	1	ถนนเยาวราช	\N	\N	7303	2556	423	2	3.73	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	7-1820-10933-10-2	\N	1	สุทธิพงษ์	\N	สกุลดี	1	1	0	0	9	ถนนชัยพฤกษ์	\N	\N	7303	2562	106	1	2.64	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	2-4531-98736-84-3	\N	1	ธนพัฒน์	\N	กิตติคุณ	1	1	0	0	8	ถนนบรมราชชนนี	\N	\N	7301	2558	421	3	2.43	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	8-3106-22625-62-6	\N	1	ธนพัฒน์	\N	ชูศรี	1	1	0	0	1	ถนนเพชรเกษม	\N	\N	7302	2559	113	1	3.91	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	2-9379-14192-76-7	\N	1	เจษฎา	\N	ทั่วถึง	1	1	0	0	8	ถนนห้วยแก้ว	\N	\N	7303	2557	422	2	3.49	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	6-3108-99931-76-4	\N	1	ปรเมศวร์	\N	รุ่งเรือง	1	1	0	0	3	ถนนโชคชัย	\N	\N	7302	2556	423	3	3.57	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	1	10010008	4-2272-37030-20-8	\N	1	ธัชพล	\N	สกุลดี	1	1	0	0	5	ถนนสุรวงศ์	\N	\N	7303	2559	113	2	3.9	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	3-6646-54916-88-4	\N	1	ปัณณทัต	\N	วิไลวรรณ	1	1	0	0	8	ถนนอุดรดุษฎี	\N	\N	7302	2559	113	3	3.9	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	7-6530-24450-59-4	\N	2	ชลธิชา	\N	พรประเสริฐ	2	1	0	0	10	ถนนรามคำแหง	\N	\N	7302	2567	101	2	3.63	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	7-3820-80124-21-4	\N	3	รัตนาภรณ์	\N	จันทร์แก้ว	2	1	0	0	5	ถนนรามคำแหง	\N	\N	7303	2566	102	3	3.54	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	8-6098-87693-63-9	\N	1	ชาตรี	\N	มณีรัตน์	1	1	0	0	8	ถนนห้วยแก้ว	\N	\N	7302	2566	102	2	3.1	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	3-2882-77539-72-4	\N	3	สุดารัตน์	\N	สกุลดี	2	1	0	0	10	ถนนประดิษฐ์มนูธรรม	\N	\N	7303	2562	106	3	2.51	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	8-8718-46634-15-6	\N	1	ชนะชัย	\N	งามดี	1	1	0	0	1	ถนนสาทร	\N	\N	7302	2566	102	2	3.27	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	1-9936-96868-63-6	\N	1	ชาตรี	\N	ใจดี	1	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	7302	2566	102	3	3.07	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	2-4743-50360-21-3	\N	1	ปิยังกูร	\N	กิตติคุณ	1	1	0	0	6	ถนนสุรวงศ์	\N	\N	7303	2562	106	2	3.77	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	8-3217-90068-89-8	\N	1	สิรภพ	\N	สุขสันต์	1	1	0	0	7	ถนนบายพาส	\N	\N	7301	2558	421	2	2.74	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	4-4819-38049-58-8	\N	2	สุนิสา	\N	วังขวา	2	1	0	0	8	ถ.รัฐพัฒนา	\N	\N	7301	2556	423	2	3.26	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	2-2834-78127-33-1	\N	2	สุดารัตน์	\N	ทองดี	2	1	0	0	1	ถนนสาทร	\N	\N	7303	2561	111	3	3.04	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	8-4245-27722-16-4	\N	2	ปัณฑิตา	\N	ชัยมงคล	2	1	0	0	2	ถนนพหลโยธิน	\N	\N	7302	2566	102	3	3.53	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	5-8780-76686-75-8	\N	3	จิราพร	\N	พันธุ์ดี	2	1	0	0	10	ถ.รัฐพัฒนา	\N	\N	7304	2563	105	1	3.69	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	2-2621-48308-86-2	\N	3	มณีรัตน์	\N	นิ่มนวล	2	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	7303	2557	422	3	3.16	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	6-2579-12719-78-4	\N	2	ชลธิชา	\N	เจริญชัย	2	1	0	0	3	ถ.บ้านโป่ง	\N	\N	7302	2558	421	3	3.44	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	3-7312-53379-17-4	\N	3	จิราพร	\N	บุญรอด	2	1	0	0	1	ถนนห้วยแก้ว	\N	\N	7303	2567	103	1	2.24	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	8-7668-59010-22-4	\N	1	สิรภพ	\N	จันทร์แก้ว	1	1	0	0	4	ถนนช้างเผือก	\N	\N	7301	2567	101	1	2.56	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	7-2157-13968-79-5	\N	1	สุทธิพงษ์	\N	พันธุ์ดี	1	1	0	0	10	ถนนราษฎร์บูรณะ	\N	\N	7303	2557	422	2	2.11	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	8-7527-19156-28-8	\N	3	วรรณภา	\N	สง่างาม	2	1	0	0	7	ถ.บ้านโป่ง	\N	\N	7303	2566	102	3	3.94	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	7-2118-46797-39-2	\N	2	นันทพร	\N	ยิ้มแย้ม	2	1	0	0	6	ถนนอ่อนนุช	\N	\N	7302	2561	111	2	3.34	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	1-1522-78131-52-1	\N	1	ณัฐวรรธน์	\N	ขาวสะอาด	1	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	7303	2562	106	1	2.36	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	5-4003-41935-72-4	\N	1	ธนาธิป	\N	นามมนตรี	1	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	7301	2567	103	1	2.59	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	8-3030-77184-83-8	\N	1	พิพัฒน์	\N	ปัญญาดี	1	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	7302	2562	106	1	2.58	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	5-3311-94120-88-3	\N	1	ทัศนัย	\N	ลือชา	1	1	0	0	2	ถนนลาดพร้าว	\N	\N	7304	2558	421	3	3.63	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	2-6581-21389-71-6	\N	1	วุฒิพงษ์	\N	บุญมี	1	1	0	0	1	ถ.บ้านโป่ง	\N	\N	7304	2567	103	3	3.58	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	5-7381-20524-89-7	\N	2	นลินทิพย์	\N	อินทร์ชัย	2	1	0	0	6	ถนนบรมราชชนนี	\N	\N	7302	2561	111	3	2.31	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	7-6184-79637-98-7	\N	2	จิราพร	\N	ลือชา	2	1	0	0	9	ถนนอุดรดุษฎี	\N	\N	7301	2564	104	2	3.07	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	8-8577-22652-96-8	\N	1	ชูเกียรติ	\N	มงคล	1	1	0	0	2	ถนนศรีนครินทร์	\N	\N	7302	2563	105	3	2.74	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	8-1017-97275-72-1	\N	1	สุทธิพงษ์	\N	ชูศรี	1	1	0	0	1	ถนนสรงประภา	\N	\N	7302	2567	103	1	3.09	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	6-3998-67993-74-5	\N	1	ชัยชนะ	\N	มีสุข	1	1	0	0	4	ถนนพหลโยธิน	\N	\N	7304	2567	103	3	2.7	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	7-5699-65526-53-5	\N	1	วิชญ์พล	\N	คงพิทักษ์	1	1	0	0	10	ถนนบรมราชชนนี	\N	\N	7304	2563	105	3	3.51	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	3-1126-37462-84-3	\N	3	บุษยา	\N	คงพิทักษ์	2	1	0	0	3	ถนนบายพาส	\N	\N	7304	2567	101	3	3.57	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	8-9704-58239-46-6	\N	3	วาสนา	\N	มณีรัตน์	2	1	0	0	8	ถนนบายพาส	\N	\N	7302	2556	423	2	2.74	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	5-4360-12367-74-2	\N	2	สิริมา	\N	ชูศรี	2	1	0	0	4	ถนนสรงประภา	\N	\N	7302	2559	113	3	3.91	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	3-3680-65255-60-5	\N	1	ธนาธิป	\N	สุวรรณภูมิ	1	1	0	0	4	ถนนกลางเมือง	\N	\N	7304	2564	104	1	2.67	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	8-4807-22850-46-3	\N	1	สุทธิพงษ์	\N	นามมนตรี	1	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	7303	2566	102	3	3.47	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	4-3493-99175-74-1	\N	1	อภิวัฒน์	\N	พรสวรรค์	1	1	0	0	8	ถนนงามวงศ์วาน	\N	\N	7303	2567	103	2	2.97	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	7-5470-24838-90-8	\N	1	ณัฐพล	\N	รักษ์ไทย	1	1	0	0	10	ถนนสุรวงศ์	\N	\N	7303	2558	421	3	3.55	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	4-9281-35649-35-9	\N	3	เพ็ญพักตร์	\N	คงพิทักษ์	2	1	0	0	8	ถนนอุดรดุษฎี	\N	\N	7302	2566	102	3	3.65	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	3-6660-77203-25-8	\N	1	นพรัตน์	\N	สีดา	1	1	0	0	4	ถนนประดิษฐ์มนูธรรม	\N	\N	7304	2558	421	3	3.58	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	6-1608-74376-91-4	\N	2	บุษยา	\N	เจริญชัย	2	1	0	0	8	ถนนนวมินทร์	\N	\N	7303	2561	111	3	2.46	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	7-9460-43508-86-7	\N	3	พรทิพย์	\N	บุญมี	2	1	0	0	1	ถนนอ่อนนุช	\N	\N	7301	2564	104	3	3.14	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	1	10010008	3-3527-63520-94-7	\N	1	ศิวกร	\N	สมบูรณ์	1	1	0	0	3	ถนนนวมินทร์	\N	\N	7303	2557	422	3	2.79	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	8-9819-64173-66-4	\N	1	ณัฐพล	\N	มีสุข	1	1	0	0	10	ถ.เอกชัย	\N	\N	7304	2566	102	2	3.61	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	5-8048-75716-83-4	\N	1	ปิยังกูร	\N	ใจดี	1	1	0	0	4	ถนนลาดพร้าว	\N	\N	7301	2556	423	3	3.15	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	3-7355-25381-17-4	\N	3	สิริมา	\N	นามมนตรี	2	1	0	0	4	ถนนชัยพฤกษ์	\N	\N	7301	2566	102	1	3.96	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	5-2819-90492-78-7	\N	3	กัญญา	\N	กิตติคุณ	2	1	0	0	7	ถนนบรมราชชนนี	\N	\N	7302	2567	101	2	2.66	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	1	10010008	6-8742-33918-43-8	\N	1	อภิวัฒน์	\N	ชูศรี	1	1	0	0	7	ถนนสาทร	\N	\N	7303	2563	105	2	2.48	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	8-3291-82450-96-5	\N	2	กาญจนา	\N	พรสวรรค์	2	1	0	0	4	ถนนโชคชัย	\N	\N	7304	2564	104	2	2.26	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	3-5386-94524-50-1	\N	2	ปิยนุช	\N	มณีรัตน์	2	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	7304	2556	423	3	3.87	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	8-7139-45811-38-5	\N	2	เพ็ญพักตร์	\N	ขาวสะอาด	2	1	0	0	6	ถนนสุรวงศ์	\N	\N	7304	2566	102	2	3.58	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	8-8479-28667-29-3	\N	3	วิมลรัตน์	\N	จันทร์แก้ว	2	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	7301	2563	105	2	3.44	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	1-3420-75113-11-3	\N	2	นภาพร	\N	งามดี	2	1	0	0	8	ถนนกลางเมือง	\N	\N	7303	2562	106	1	3.9	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	7-4985-80454-98-1	\N	1	สุรชัย	\N	สุขสันต์	1	1	0	0	6	ถนนเพชรเกษม	\N	\N	7304	2567	101	2	3.65	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	7-9449-19223-29-1	\N	2	มณีรัตน์	\N	ศักดิ์สิทธิ์	2	1	0	0	8	ถนนช้างเผือก	\N	\N	7304	2560	112	3	2.02	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	6-6995-79434-54-4	\N	1	ณัฐพล	\N	มณีรัตน์	1	1	0	0	10	ถนนราษฎร์บูรณะ	\N	\N	7304	2563	105	3	3.37	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	4-3973-26668-22-5	\N	1	สิรภพ	\N	หอมหวาน	1	1	0	0	9	ถนนนิมมานเหมินท์	\N	\N	7303	2567	103	2	2.81	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	4-4417-16788-40-9	\N	2	กัญญาณัฐ	\N	นิ่มนวล	2	1	0	0	2	ถนนห้วยแก้ว	\N	\N	7303	2567	103	2	2.92	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	7-7051-18541-11-7	\N	3	มาลัย	\N	ชูศรี	2	1	0	0	4	ถนนมาลัยแมน	\N	\N	7301	2560	112	1	2.7	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	5-1672-75862-92-2	\N	1	ชัยชนะ	\N	ธนาคาร	1	1	0	0	2	ถ.รัฐพัฒนา	\N	\N	7301	2564	104	3	3.73	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	3-2134-46096-50-3	\N	1	ภูมิพัฒน์	\N	สุจริต	1	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	7304	2563	105	3	2.46	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	3-2224-75858-55-1	\N	2	อรณิชา	\N	สุขสบาย	2	1	0	0	6	ถนนบายพาส	\N	\N	7302	2557	422	2	2.11	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	7-1874-44429-99-9	\N	1	นพรัตน์	\N	ดีสมัย	1	1	0	0	6	ถนนเจริญกรุง	\N	\N	7301	2556	423	1	2.3	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	1-4961-81252-64-6	\N	3	ชนิดา	\N	นิ่มนวล	2	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	7301	2567	103	2	2.69	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	1-7107-43225-75-8	\N	1	ทักษิณ	\N	สง่างาม	1	1	0	0	5	ถนนเจริญกรุง	\N	\N	7302	2560	112	3	3.69	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	1-7087-61445-10-5	\N	3	ปัณฑิตา	\N	ประสิทธิ์ผล	2	1	0	0	5	ถนนสุดสาคร	\N	\N	7304	2557	422	1	2.05	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	4-6480-16898-63-7	\N	1	ประพันธ์	\N	สุขสบาย	1	1	0	0	6	ถนนบายพาส	\N	\N	7301	2557	422	3	3.56	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	6-7104-70000-64-6	\N	3	วรรณภา	\N	มณีรัตน์	2	1	0	0	8	ถนนนวมินทร์	\N	\N	7303	2564	104	1	3.7	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	5-8987-44937-38-8	\N	1	สุรชัย	\N	ดำรงค์	1	1	0	0	3	ถนนลาดพร้าว	\N	\N	7302	2563	105	1	3.85	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	7-1299-87658-25-1	\N	1	ณัฐวุฒิ	\N	รักษ์ไทย	1	1	0	0	3	ถ.รัฐพัฒนา	\N	\N	7301	2556	423	3	3.86	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	4-3758-20572-22-2	\N	3	อภิญญา	\N	ใจดี	2	1	0	0	10	ถนนรัตนาธิเบศร์	\N	\N	7303	2559	113	2	3.35	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	4-2786-38731-41-1	\N	1	ภัคพล	\N	อ่อนน้อม	1	1	0	0	10	ถนนนวมินทร์	\N	\N	7304	2557	422	1	2.97	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	1-4396-50460-59-4	\N	1	ชนะชัย	\N	หอมหวาน	1	1	0	0	4	ถนนศรีนครินทร์	\N	\N	7303	2559	113	1	2.98	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	7-7781-79661-14-6	\N	2	ปาณิสรา	\N	พรสวรรค์	2	1	0	0	9	ถนนลาดพร้าว	\N	\N	7303	2556	423	2	2.81	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	4-9920-25183-51-8	\N	1	ณัฐพล	\N	วังขวา	1	1	0	0	6	ถนนรัตนาธิเบศร์	\N	\N	7303	2561	111	3	3.38	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	6-8439-80838-23-9	\N	1	ณัฐวุฒิ	\N	นามมนตรี	1	1	0	0	1	ถ.เอกชัย	\N	\N	7302	2558	421	3	3.49	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	2-6694-97779-91-2	\N	3	เพ็ญพักตร์	\N	นิ่มนวล	2	1	0	0	5	ถนนกาญจนาภิเษก	\N	\N	7301	2556	423	3	3.96	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	1-1061-63303-56-7	\N	2	สุนิสา	\N	คงพิทักษ์	2	1	0	0	3	ถนนสุดสาคร	\N	\N	7303	2556	423	1	2.91	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	7-4601-75224-73-7	\N	3	อัมพร	\N	พันธุ์ดี	2	1	0	0	7	ถนนกลางเมือง	\N	\N	7303	2563	105	1	3.55	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	3-4817-83537-23-7	\N	2	เพ็ญพักตร์	\N	เพ็งพา	2	1	0	0	3	ถนนศรีนครินทร์	\N	\N	7302	2562	106	2	3.85	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	7-2584-50901-59-3	\N	3	อัมพร	\N	วิริยะ	2	1	0	0	9	ถนนเจริญกรุง	\N	\N	7303	2558	421	3	2.22	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	4-4289-21364-94-6	\N	1	ธัชพล	\N	คงมั่น	1	1	0	0	2	ถนนอ่อนนุช	\N	\N	7303	2559	113	1	3.32	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	8-1078-31476-72-9	\N	1	ณัฐวรรธน์	\N	ดีสมัย	1	1	0	0	5	ถ.เอกชัย	\N	\N	7303	2567	101	1	3.72	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	3-4713-91342-24-8	\N	1	พิพัฒน์	\N	ขาวสะอาด	1	1	0	0	7	ถนนงามวงศ์วาน	\N	\N	7304	2567	103	1	3	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	5-4228-25744-37-6	\N	2	กัญญา	\N	เพ็งพา	2	1	0	0	8	ถนนนิมมานเหมินท์	\N	\N	7303	2567	101	3	3.01	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	8-4199-89964-71-3	\N	1	คุณากร	\N	มีสุข	1	1	0	0	10	ถนนมาลัยแมน	\N	\N	7303	2561	111	2	2.25	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	1-7305-26345-74-4	\N	1	เอกพงษ์	\N	กิตติคุณ	1	1	0	0	5	ถนนเยาวราช	\N	\N	7303	2561	111	2	2.99	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	5-6468-51055-19-3	\N	1	ชาตรี	\N	ศรีสุข	1	1	0	0	5	ถนนเพชรเกษม	\N	\N	7301	2561	111	1	3.28	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	7-2427-97928-67-1	\N	3	อรณิชา	\N	พงษ์ไพร	2	1	0	0	7	ถนนเยาวราช	\N	\N	7303	2567	103	2	2.21	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	6-3936-12630-22-6	\N	1	พิพัฒน์	\N	ขาวสะอาด	1	1	0	0	7	ถนนเพชรเกษม	\N	\N	7303	2567	103	1	3.09	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	4-4076-72281-64-9	\N	2	อัมพร	\N	เจริญชัย	2	1	0	0	5	ถนนพหลโยธิน	\N	\N	7303	2567	103	2	3.79	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	1-8978-24585-83-6	\N	1	ชินดนัย	\N	นามมนตรี	1	1	0	0	8	ถนนเพชรเกษม	\N	\N	7301	2561	111	3	2.32	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	1	10010008	6-6355-79758-34-9	\N	2	มณีรัตน์	\N	ขาวสะอาด	2	1	0	0	8	ถนนสาทร	\N	\N	7303	2561	111	2	3.25	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	2-9478-16502-78-5	\N	2	กัญญา	\N	บริบูรณ์	2	1	0	0	4	ถนนเจริญกรุง	\N	\N	7302	2567	101	2	3.14	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	3-4201-95477-12-1	\N	1	วีรชัย	\N	ปัญญาดี	1	1	0	0	8	ถนนสุขุมวิท	\N	\N	7303	2556	423	1	3.72	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	1-7187-98023-10-5	\N	3	สุมาลี	\N	นามมนตรี	2	1	0	0	6	ถนนรามคำแหง	\N	\N	7303	2559	113	1	2.47	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	3-9076-93643-58-4	\N	1	ธนพัฒน์	\N	วงษ์สุวรรณ	1	1	0	0	3	ถ.รัฐพัฒนา	\N	\N	7304	2560	112	1	2.11	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	6-1970-44304-36-3	\N	1	ดิศรณ์	\N	คงมั่น	1	1	0	0	7	ถนนลาดพร้าว	\N	\N	7304	2561	111	2	3.3	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	3-3691-64830-94-6	\N	2	มาลัย	\N	หอมหวาน	2	1	0	0	5	ถนนสาทร	\N	\N	7304	2557	422	2	2.42	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	5-7048-22654-34-6	\N	1	ทัศนัย	\N	สุวรรณภูมิ	1	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	7302	2562	106	2	3.78	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	1	10010008	8-3561-71217-42-1	\N	3	นันทพร	\N	แสงสว่าง	2	1	0	0	6	ถนนบรมราชชนนี	\N	\N	7304	2562	106	3	2.05	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	2-4278-66912-56-7	\N	2	นวลจันทร์	\N	ศรีสุข	2	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	7304	2560	112	1	3.58	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	7-3083-80781-92-3	\N	1	อนุชา	\N	เกียรติสกุล	1	1	0	0	3	ถนนอ่อนนุช	\N	\N	7303	2562	106	2	2.08	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	6-5925-58140-81-3	\N	3	สิริมา	\N	มงคล	2	1	0	0	3	ถนนห้วยแก้ว	\N	\N	7304	2564	104	3	2.54	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	5-8294-70086-55-7	\N	1	ชัยชนะ	\N	ลือชา	1	1	0	0	6	ถนนห้วยแก้ว	\N	\N	7303	2561	111	2	2.52	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	7-9035-63456-64-6	\N	1	ดิศรณ์	\N	วิริยะ	1	1	0	0	8	ถนนรัตนาธิเบศร์	\N	\N	7303	2563	105	1	3.07	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	2-5020-39425-92-9	\N	1	ศุภณัฐ	\N	ทั่วถึง	1	1	0	0	8	ถนนมิตรภาพ	\N	\N	7301	2562	106	1	2.26	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	4-6501-47817-96-6	\N	1	ชัยชนะ	\N	สง่างาม	1	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	7303	2566	102	1	2.95	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	3-7089-47532-37-1	\N	1	ทักษิณ	\N	สกุลดี	1	1	0	0	10	ถนนอ่อนนุช	\N	\N	7302	2558	421	3	2.25	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	8-4206-99165-46-7	\N	2	ดวงใจ	\N	งามดี	2	1	0	0	7	ถนนสุขุมวิท	\N	\N	7303	2562	106	1	2.7	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	8-6257-64423-23-1	\N	2	บุษยา	\N	ทั่วถึง	2	1	0	0	9	ถนนลาดพร้าว	\N	\N	7303	2567	101	1	3.94	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	2-3291-37479-84-6	\N	1	กิตติภณ	\N	พรสวรรค์	1	1	0	0	6	ถนนเพชรเกษม	\N	\N	7302	2567	101	1	2.77	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	4-3511-82808-55-5	\N	1	ชนะชัย	\N	ปัญญาดี	1	1	0	0	2	ถนนเยาวราช	\N	\N	7304	2557	422	3	2.45	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	3-2864-48662-43-6	\N	1	ดิศรณ์	\N	รุ่งเรือง	1	1	0	0	4	ถ.เอกชัย	\N	\N	7302	2558	421	2	3.49	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	7-9003-81245-66-8	\N	1	ชาตรี	\N	อ่อนน้อม	1	1	0	0	9	ถนนโชคชัย	\N	\N	7301	2567	101	2	2.69	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	1	10010008	2-4408-33410-64-9	\N	1	ชูเกียรติ	\N	สุขสันต์	1	1	0	0	5	ถนนศรีนครินทร์	\N	\N	7301	2567	101	3	3.03	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	5-7791-90062-97-1	\N	1	ธนาธิป	\N	วังขวา	1	1	0	0	4	ถนนอ่อนนุช	\N	\N	7304	2557	422	2	2.71	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	8-5052-33067-35-9	\N	2	วันวิสา	\N	วงษ์สุวรรณ	2	1	0	0	2	ถนนมิตรภาพ	\N	\N	7301	2567	103	2	2.35	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	3-7241-10864-33-4	\N	3	เกวลิน	\N	บุญมี	2	1	0	0	6	ถนนอุดรดุษฎี	\N	\N	7304	2564	104	3	3.04	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	6-1203-73137-99-9	\N	2	ณัฐนิชา	\N	สุขสบาย	2	1	0	0	7	ถ.บ้านโป่ง	\N	\N	7304	2560	112	3	3.96	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	5-8538-45765-59-2	\N	2	ดรุณี	\N	เพียรดี	2	1	0	0	3	ถนนสุรวงศ์	\N	\N	7301	2563	105	3	2.25	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	1	10010008	6-6518-24821-73-6	\N	1	ไกรวุฒิ	\N	สุดสวย	1	1	0	0	9	ถนนสุดสาคร	\N	\N	7301	2567	103	1	2.72	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	8-1561-27113-74-7	\N	1	กวินท์	\N	คงมั่น	1	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	7303	2561	111	1	2.5	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	3-2098-17782-95-7	\N	3	บุษยา	\N	ปัญญาดี	2	1	0	0	6	ถนนบรมราชชนนี	\N	\N	7303	2562	106	1	2.18	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	6-5754-36339-20-1	\N	3	ดวงใจ	\N	สุขสันต์	2	1	0	0	6	ถนนมิตรภาพ	\N	\N	7304	2560	112	3	3.87	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	3-8552-53324-83-7	\N	2	ศิริพร	\N	เพียรดี	2	1	0	0	1	ถนนประดิษฐ์มนูธรรม	\N	\N	7301	2561	111	3	2.3	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	5-4339-43534-30-4	\N	3	กัญญา	\N	นิ่มนวล	2	1	0	0	2	ถนนเยาวราช	\N	\N	7304	2560	112	1	3.98	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	7-1743-65608-27-1	\N	2	เกวลิน	\N	ทั่วถึง	2	1	0	0	10	ถนนโชคชัย	\N	\N	7301	2560	112	2	3.41	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	1	10010008	2-6193-26269-48-2	\N	1	นพรัตน์	\N	ทองดี	1	1	0	0	5	ถนนพหลโยธิน	\N	\N	7303	2556	423	3	3.15	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	5-3646-88827-98-7	\N	3	วรรณภา	\N	สุขสบาย	2	1	0	0	4	ถนนมาลัยแมน	\N	\N	7301	2556	423	3	2.53	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	5-4591-85352-32-5	\N	2	ชลธิชา	\N	เพ็งพา	2	1	0	0	6	ถนนสาทร	\N	\N	7304	2562	106	2	2.27	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	8-5639-92457-45-3	\N	3	พิมพ์ชนก	\N	บุญมี	2	1	0	0	6	ถนนสุรวงศ์	\N	\N	7303	2567	103	3	3.92	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	3-1313-84500-22-9	\N	3	ปิยนุช	\N	งามดี	2	1	0	0	9	ถนนเพชรเกษม	\N	\N	7302	2567	103	2	3.11	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	3-9796-15128-87-8	\N	1	อภิวัฒน์	\N	ขาวสะอาด	1	1	0	0	1	ถนนราษฎร์บูรณะ	\N	\N	7304	2559	113	1	3.87	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	7-5044-56917-22-6	\N	1	ไกรวุฒิ	\N	งามดี	1	1	0	0	10	ถนนงามวงศ์วาน	\N	\N	7304	2559	113	3	2.03	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	3-6739-36712-40-8	\N	1	สุรชัย	\N	ชัยมงคล	1	1	0	0	10	ถ.เอกชัย	\N	\N	7302	2566	102	1	3.16	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	8-6662-82134-68-3	\N	1	ปิยังกูร	\N	เจริญชัย	1	1	0	0	6	ถนนอ่อนนุช	\N	\N	7301	2560	112	3	2.47	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	1	10010008	4-1406-10969-35-3	\N	3	กัญญาณัฐ	\N	บุญมี	2	1	0	0	6	ถนนบายพาส	\N	\N	7301	2563	105	2	2.46	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	1	10010008	4-2146-23159-55-2	\N	3	อภิญญา	\N	งามดี	2	1	0	0	10	ถนนมาลัยแมน	\N	\N	7303	2563	105	1	3.85	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	7-4235-21391-57-5	\N	1	ทักษิณ	\N	พันธุ์ดี	1	1	0	0	4	ถนนสุขุมวิท	\N	\N	7303	2556	423	1	2.82	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	6-7241-93963-53-4	\N	1	นรวิชญ์	\N	อ่อนน้อม	1	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	7303	2563	105	1	2.49	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	2-5939-52574-31-3	\N	2	กัญญาณัฐ	\N	ประสิทธิ์ผล	2	1	0	0	9	ถนนสรงประภา	\N	\N	7303	2561	111	3	2.55	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	3	10010008	3-8321-90260-82-4	\N	1	ปรเมศวร์	\N	วิไลวรรณ	1	1	0	0	5	ถนนมาลัยแมน	\N	\N	7302	2567	101	3	3.49	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	8-1002-99570-59-5	\N	3	ลลิตา	\N	วิไลวรรณ	2	1	0	0	1	ถนนอุดรดุษฎี	\N	\N	7302	2564	104	2	2.52	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	5-5280-70321-74-4	\N	2	กัญญาณัฐ	\N	ดีสมัย	2	1	0	0	1	ถ.ประชาสามัคคี	\N	\N	7301	2567	101	2	2.56	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	4-5412-84858-24-5	\N	2	พิมพ์ชนก	\N	ประสิทธิ์ผล	2	1	0	0	2	ถนนสุขุมวิท	\N	\N	7302	2558	421	2	3.27	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	3-8609-30026-19-3	\N	3	อรณิชา	\N	คงพิทักษ์	2	1	0	0	7	ถนนเยาวราช	\N	\N	7304	2564	104	2	3.88	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	8-8102-72752-94-5	\N	2	วิมลรัตน์	\N	เจริญชัย	2	1	0	0	7	ถ.เอกชัย	\N	\N	7304	2562	106	3	3.3	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	2-4808-37017-38-3	\N	1	วีรชัย	\N	คงพิทักษ์	1	1	0	0	8	ถนนประดิษฐ์มนูธรรม	\N	\N	7304	2567	101	1	3.84	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	7-8929-25810-87-7	\N	1	ชนะชัย	\N	สุขสันต์	1	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	7304	2561	111	1	3.35	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	6-7921-26145-63-1	\N	2	เพ็ญพักตร์	\N	มงคล	2	1	0	0	4	ถนนนวมินทร์	\N	\N	7303	2561	111	2	3.52	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	3-3583-75762-68-6	\N	3	มาลัย	\N	สุดสวย	2	1	0	0	7	ถนนงามวงศ์วาน	\N	\N	7302	2558	421	1	3.64	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	6-3780-91349-34-3	\N	2	กัญญาณัฐ	\N	ดำรงค์	2	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	7304	2557	422	1	3.34	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	4-1898-39173-46-8	\N	1	นพรัตน์	\N	วิริยะ	1	1	0	0	2	ถนนบรมราชชนนี	\N	\N	7303	2556	423	2	3.14	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	3-4839-79227-90-6	\N	1	ณัฐพล	\N	บุญมี	1	1	0	0	10	ถนนช้างเผือก	\N	\N	7304	2559	113	1	3.66	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	1-8613-29981-28-4	\N	1	อนุชา	\N	สุจริต	1	1	0	0	1	ถนนสาทร	\N	\N	7302	2567	103	3	2.48	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	6-2107-23836-99-2	\N	1	ประพันธ์	\N	ทั่วถึง	1	1	0	0	4	ถ.บ้านโป่ง	\N	\N	7302	2556	423	1	3.15	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	7-8169-79920-30-4	\N	3	นลินทิพย์	\N	คงพิทักษ์	2	1	0	0	7	ถนนพหลโยธิน	\N	\N	7302	2561	111	3	3.98	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	5-5263-76712-58-6	\N	2	ธัญชนก	\N	ชูศรี	2	1	0	0	8	ถนนกาญจนาภิเษก	\N	\N	7304	2559	113	2	2.21	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	5-5894-84190-88-2	\N	1	ภูมิพัฒน์	\N	ประสิทธิ์ผล	1	1	0	0	10	ถนนโชคชัย	\N	\N	7302	2566	102	2	3.29	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	1	10010008	1-9482-45610-40-4	\N	2	นันทพร	\N	สมบูรณ์	2	1	0	0	10	ถนนรามคำแหง	\N	\N	7301	2556	423	1	2.02	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	4-1346-92005-53-1	\N	2	กัญญาณัฐ	\N	งามดี	2	1	0	0	8	ถนนกาญจนาภิเษก	\N	\N	7301	2564	104	3	2.94	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	3-1097-28623-76-5	\N	3	วรรณภา	\N	พันธุ์ดี	2	1	0	0	5	ถนนรามคำแหง	\N	\N	7302	2564	104	2	2.37	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	1-9513-78974-52-2	\N	3	กัญญาณัฐ	\N	ชูศรี	2	1	0	0	7	ถนนสีลม	\N	\N	7302	2567	101	1	2.91	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	6-8909-97127-47-2	\N	1	ปัณณทัต	\N	วิริยะ	1	1	0	0	1	ถนนสุรวงศ์	\N	\N	7301	2567	103	2	2.23	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	6-3107-57202-78-4	\N	2	สุนิสา	\N	สมบูรณ์	2	1	0	0	9	ถนนมิตรภาพ	\N	\N	7304	2560	112	3	2.54	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	2-7739-47076-45-7	\N	1	ภัคพล	\N	อินทร์ชัย	1	1	0	0	7	ถนนโชคชัย	\N	\N	7303	2566	102	3	2.61	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	1-2646-17713-32-2	\N	2	กาญจนา	\N	ปัญญาดี	2	1	0	0	6	ถนนเจริญกรุง	\N	\N	7302	2562	106	3	3.82	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	2-1871-22288-46-7	\N	2	แสงดาว	\N	สุขสันต์	2	1	0	0	1	ถนนสรงประภา	\N	\N	7301	2557	422	2	3.05	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	7-9345-31365-75-1	\N	1	ชูเกียรติ	\N	ทั่วถึง	1	1	0	0	2	ถนนกาญจนาภิเษก	\N	\N	7303	2561	111	2	3.34	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	2-7539-74904-58-7	\N	1	ปิยังกูร	\N	ศรีสุข	1	1	0	0	1	ถนนชัยพฤกษ์	\N	\N	7302	2558	421	2	2.86	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	5-8676-77185-97-8	\N	3	ภัทรวดี	\N	ศักดิ์สิทธิ์	2	1	0	0	2	ถนนนวมินทร์	\N	\N	7302	2556	423	3	3.79	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	8-1748-55624-21-1	\N	1	ทักษิณ	\N	ดีสมัย	1	1	0	0	5	ถ.เอกชัย	\N	\N	7302	2560	112	2	3.34	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	2-4531-24907-20-5	\N	1	ธนภัทร	\N	ยิ้มแย้ม	1	1	0	0	9	ถนนศรีนครินทร์	\N	\N	7301	2566	102	3	2.75	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	5-6064-60042-82-8	\N	2	สมหญิง	\N	สุขสันต์	2	1	0	0	9	ถนนวิภาวดีรังสิต	\N	\N	7303	2557	422	1	2.55	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	1-1348-21984-85-8	\N	1	ณัฐวุฒิ	\N	ดำรงค์	1	1	0	0	7	ถนนเจริญกรุง	\N	\N	7304	2561	111	2	3.24	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	6-2462-97375-21-4	\N	1	ปัณณทัต	\N	นามมนตรี	1	1	0	0	1	ถนนสาทร	\N	\N	7303	2563	105	1	2.52	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	7-2741-60823-97-7	\N	1	กวินท์	\N	สง่างาม	1	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	7304	2567	103	1	3.06	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	5-9573-19287-75-2	\N	2	สุดารัตน์	\N	ธนาคาร	2	1	0	0	9	ถนนบายพาส	\N	\N	7301	2557	422	3	2.98	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	6-8207-28636-49-8	\N	2	จิตรลดา	\N	อินทร์ชัย	2	1	0	0	8	ถนนราษฎร์บูรณะ	\N	\N	7303	2559	113	2	2.11	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	3-1419-86402-19-7	\N	1	วิชญ์พล	\N	สง่างาม	1	1	0	0	1	ถนนกาญจนาภิเษก	\N	\N	7304	2557	422	3	3.93	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	1-2024-67524-17-7	\N	3	สุภัสสรา	\N	ทั่วถึง	2	1	0	0	7	ถนนเจริญกรุง	\N	\N	7302	2561	111	1	3.81	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	4-6665-77318-42-1	\N	3	นลินทิพย์	\N	บุญมี	2	1	0	0	5	ถ.เอกชัย	\N	\N	7301	2556	423	2	3.57	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	1	10010008	6-7361-55411-59-5	\N	1	ชูเกียรติ	\N	เกียรติสกุล	1	1	0	0	2	ถนนอุดรดุษฎี	\N	\N	7304	2557	422	1	3.66	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	2-2362-25581-27-1	\N	3	จิราพร	\N	รุ่งเรือง	2	1	0	0	8	ถนนสุขุมวิท	\N	\N	7304	2558	421	2	2.92	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	4-7016-84668-64-8	\N	1	คุณากร	\N	สุดสวย	1	1	0	0	10	ถนนศรีนครินทร์	\N	\N	7301	2562	106	3	3.05	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	2-6725-13706-40-4	\N	3	ธัญชนก	\N	สีดา	2	1	0	0	6	ถนนโชคชัย	\N	\N	7303	2564	104	2	3.03	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	4-1164-43144-36-5	\N	2	บุษยา	\N	สุขสันต์	2	1	0	0	3	ถนนราษฎร์บูรณะ	\N	\N	7304	2566	102	3	3.15	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	2-4939-38704-84-9	\N	3	บุษยา	\N	คงมั่น	2	1	0	0	10	ถนนสาทร	\N	\N	7302	2559	113	3	3.38	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	1	10010008	7-6647-82632-49-1	\N	1	สุทธิพงษ์	\N	สุขสบาย	1	1	0	0	2	ถนนนิมมานเหมินท์	\N	\N	7303	2562	106	1	2.49	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	8-9982-74021-14-1	\N	1	ชาตรี	\N	สกุลดี	1	1	0	0	10	ถนนห้วยแก้ว	\N	\N	7303	2559	113	1	3.67	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	7-4160-61764-87-2	\N	1	อภิวัฒน์	\N	สุจริต	1	1	0	0	10	ถนนรามคำแหง	\N	\N	7304	2560	112	3	2.01	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	4-7232-27443-62-7	\N	1	ชูเกียรติ	\N	พรประเสริฐ	1	1	0	0	2	ถนนมาลัยแมน	\N	\N	7304	2562	106	3	3.51	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	8-6214-34276-86-7	\N	1	วีรชัย	\N	มีสุข	1	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	7304	2563	105	2	3.83	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	8-9845-81328-21-5	\N	1	อนุชา	\N	เจริญชัย	1	1	0	0	2	ถนนสรงประภา	\N	\N	7301	2567	103	2	3.47	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	8-6535-54298-15-6	\N	2	ชนิดา	\N	ธนาคาร	2	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	7304	2567	101	1	3.04	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	6-1409-23293-38-2	\N	2	วิมลรัตน์	\N	บุญรอด	2	1	0	0	10	ถนนอ่อนนุช	\N	\N	7304	2567	103	3	3.93	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	4-5529-91712-94-9	\N	3	วรรณภา	\N	นามมนตรี	2	1	0	0	5	ถนนสาทร	\N	\N	7301	2561	111	1	2.24	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	3-6111-72227-78-7	\N	1	ปิยังกูร	\N	เพียรดี	1	1	0	0	4	ถนนมิตรภาพ	\N	\N	7301	2556	423	1	2.59	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	4-1776-75739-94-1	\N	2	ประภา	\N	คงมั่น	2	1	0	0	4	ถนนนิมมานเหมินท์	\N	\N	7304	2564	104	2	3.85	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	1-6273-48786-86-7	\N	3	วิมลรัตน์	\N	ประสิทธิ์ผล	2	1	0	0	9	ถนนมาลัยแมน	\N	\N	7303	2557	422	1	3.67	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	1-2244-84859-88-9	\N	1	วุฒิพงษ์	\N	บริบูรณ์	1	1	0	0	5	ถนนสุดสาคร	\N	\N	7302	2562	106	2	3.13	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	2-1649-38231-54-7	\N	2	สุนิสา	\N	บริบูรณ์	2	1	0	0	3	ถนนห้วยแก้ว	\N	\N	7301	2558	421	3	2.74	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	1	10010008	1-3334-79032-13-6	\N	3	ดวงใจ	\N	บุญมี	2	1	0	0	8	ถนนช้างเผือก	\N	\N	7301	2567	103	3	3.33	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	6-7986-60100-97-4	\N	2	ณัฐนิชา	\N	พรสวรรค์	2	1	0	0	1	ถนนกลางเมือง	\N	\N	7301	2558	421	2	2.55	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	2-8389-51853-79-3	\N	3	รัตนาภรณ์	\N	เกียรติสกุล	2	1	0	0	9	ถนนสาทร	\N	\N	7304	2557	422	1	2.04	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	8-7429-13784-95-8	\N	1	ณัฐวุฒิ	\N	ดีสมัย	1	1	0	0	3	ถนนพหลโยธิน	\N	\N	7304	2567	101	1	3.62	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	3-4726-94941-69-8	\N	1	อภิวัฒน์	\N	สีดา	1	1	0	0	6	ถนนมาลัยแมน	\N	\N	7303	2567	101	3	2.79	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	5	10010008	3-5543-25303-47-9	\N	3	กาญจนา	\N	เจริญชัย	2	1	0	0	5	ถนนชัยพฤกษ์	\N	\N	7304	2564	104	2	2.57	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	5-8163-55156-77-6	\N	2	นวลจันทร์	\N	กิตติคุณ	2	1	0	0	8	ถนนประดิษฐ์มนูธรรม	\N	\N	7304	2559	113	2	3.74	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	8-4966-44781-59-9	\N	3	จิราพร	\N	เกียรติสกุล	2	1	0	0	3	ถนนประดิษฐ์มนูธรรม	\N	\N	7301	2562	106	1	2.55	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	4-6345-24138-21-9	\N	3	กัญญาณัฐ	\N	สุวรรณภูมิ	2	1	0	0	8	ถ.เอกชัย	\N	\N	7302	2562	106	3	3.04	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	8-8949-67844-48-8	\N	3	นลินทิพย์	\N	ยิ้มแย้ม	2	1	0	0	7	ถนนอ่อนนุช	\N	\N	7301	2557	422	2	3.12	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	1	10010008	3-9147-73760-82-7	\N	2	รุ่งอรุณ	\N	มณีรัตน์	2	1	0	0	1	ถนนมาลัยแมน	\N	\N	7302	2562	106	3	3.07	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	1	10010008	1-6315-71691-78-5	\N	3	ลลิตา	\N	สีดา	2	1	0	0	7	ถนนศรีนครินทร์	\N	\N	7302	2559	113	2	3.37	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	3	10010008	7-6209-24848-54-4	\N	1	วรากร	\N	ประสิทธิ์ผล	1	1	0	0	2	ถนนสรงประภา	\N	\N	7302	2561	111	2	2.79	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	8-1768-79683-65-9	\N	1	ศิวกร	\N	ใจดี	1	1	0	0	7	ถนนห้วยแก้ว	\N	\N	7302	2561	111	1	3.33	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	2-9096-11845-54-4	\N	1	วสันต์	\N	หอมหวาน	1	1	0	0	10	ถนนมาลัยแมน	\N	\N	7304	2567	103	1	3.61	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	3-7351-50401-19-3	\N	2	ปัณฑิตา	\N	ปัญญาดี	2	1	0	0	5	ถนนบายพาส	\N	\N	7303	2563	105	3	3.73	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	4-6196-25039-58-9	\N	2	เกวลิน	\N	สุดสวย	2	1	0	0	4	ถนนสรงประภา	\N	\N	7303	2566	102	3	3.18	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	2-9199-16578-17-3	\N	1	ธนาธิป	\N	เพ็งพา	1	1	0	0	2	ถนนกาญจนาภิเษก	\N	\N	7304	2560	112	1	2.43	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	6-6896-68543-97-8	\N	1	กิตติภณ	\N	สีดา	1	1	0	0	4	ถนนวิภาวดีรังสิต	\N	\N	7303	2564	104	3	2.77	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	3-2086-82062-91-4	\N	1	อภิวัฒน์	\N	ศักดิ์สิทธิ์	1	1	0	0	7	ถนนบายพาส	\N	\N	7302	2559	113	3	2.14	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	8-4380-28115-83-8	\N	2	เพ็ญพักตร์	\N	สุวรรณภูมิ	2	1	0	0	6	ถนนโชคชัย	\N	\N	7301	2563	105	2	2.78	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	4-8638-16990-90-3	\N	3	ประภา	\N	สกุลดี	2	1	0	0	5	ถนนนิมมานเหมินท์	\N	\N	7302	2566	102	1	3.85	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	1-5864-71259-77-4	\N	3	เพ็ญพักตร์	\N	สุวรรณภูมิ	2	1	0	0	1	ถนนมาลัยแมน	\N	\N	7301	2561	111	1	2.88	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	8-3907-45073-44-5	\N	1	ภัคพล	\N	พันธุ์ดี	1	1	0	0	7	ถนนสุรวงศ์	\N	\N	7304	2557	422	3	3.79	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	3-8512-50070-84-4	\N	1	อภิวัฒน์	\N	สีดา	1	1	0	0	10	ถนนลาดพร้าว	\N	\N	7303	2558	421	3	3.86	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	2-6590-95960-22-3	\N	1	ณัฐวรรธน์	\N	วงษ์สุวรรณ	1	1	0	0	9	ถนนมิตรภาพ	\N	\N	7302	2562	106	1	2.36	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	1	10010008	2-7352-97715-52-3	\N	1	นรวิชญ์	\N	เจริญชัย	1	1	0	0	4	ถ.บ้านโป่ง	\N	\N	7303	2563	105	2	2.58	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	4	10010008	1-1757-36953-32-3	\N	1	ธนภัทร	\N	สง่างาม	1	1	0	0	7	ถนนสุขุมวิท	\N	\N	7304	2567	101	2	3.06	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	3-7982-71302-42-9	\N	3	นลินทิพย์	\N	งามดี	2	1	0	0	5	ถนนอุดรดุษฎี	\N	\N	7304	2567	103	3	2.72	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	4-9925-97033-55-5	\N	2	สมหญิง	\N	ใจดี	2	1	0	0	4	ถ.ประชาสามัคคี	\N	\N	7301	2567	101	1	2.83	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	2-7927-46388-53-7	\N	2	กาญจนา	\N	แสงสว่าง	2	1	0	0	9	ถนนชัยพฤกษ์	\N	\N	7303	2563	105	2	3.08	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	2	10010008	2-3445-56624-56-9	\N	1	กันตภณ	\N	คงมั่น	1	1	0	0	9	ถนนเจริญกรุง	\N	\N	7301	2562	106	3	3.33	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	2-5378-24557-26-6	\N	1	เอกพงษ์	\N	นิ่มนวล	1	1	0	0	8	ถนนสุขุมวิท	\N	\N	7302	2563	105	1	2.95	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	5	10010008	3-5917-43247-53-5	\N	2	ลลิตา	\N	บริบูรณ์	2	1	0	0	8	ถนนห้วยแก้ว	\N	\N	7304	2567	103	3	3.41	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	3	10010008	8-4455-25350-96-1	\N	2	ชลธิชา	\N	อินทร์ชัย	2	1	0	0	3	ถนนนิมมานเหมินท์	\N	\N	7301	2558	421	3	3.99	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	7-4781-84958-45-7	\N	1	วีรชัย	\N	พรสวรรค์	1	1	0	0	9	ถนนวิภาวดีรังสิต	\N	\N	7303	2564	104	3	3.51	10	นครปฐม	เมืองนครปฐม	พระประโทน
2569	1	1	10010008	6-6651-75984-70-3	\N	2	วาสนา	\N	วังขวา	2	1	0	0	7	ถนนอ่อนนุช	\N	\N	7301	2564	104	3	2.23	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	3	10010008	8-2162-89421-29-7	\N	1	อนุชา	\N	พรสวรรค์	1	1	0	0	5	ถนนศรีนครินทร์	\N	\N	7304	2556	423	1	3.68	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	3-9458-81742-13-8	\N	1	เอกพงษ์	\N	สุขสบาย	1	1	0	0	4	ถนนอุดรดุษฎี	\N	\N	7302	2557	422	3	3.56	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	1	10010008	6-1043-99557-90-2	\N	3	วันวิสา	\N	ดำรงค์	2	1	0	0	10	ถนนสุดสาคร	\N	\N	7304	2567	101	2	3.47	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	1-3820-19587-19-2	\N	2	พรทิพย์	\N	สุวรรณภูมิ	2	1	0	0	9	ถ.เอกชัย	\N	\N	7304	2564	104	1	3.25	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	3-3094-17216-55-4	\N	1	ณัฐวรรธน์	\N	ทองดี	1	1	0	0	3	ถนนราษฎร์บูรณะ	\N	\N	7301	2564	104	3	3.77	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	5	10010008	1-9669-84874-77-1	\N	1	ปิยังกูร	\N	ชูศรี	1	1	0	0	5	ถนนอุดรดุษฎี	\N	\N	7302	2561	111	3	2.85	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	1	10010008	3-5318-71051-55-2	\N	3	ชลธิชา	\N	ศรีสุข	2	1	0	0	2	ถ.บ้านโป่ง	\N	\N	7301	2558	421	2	2.94	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	4	10010008	7-9436-79579-90-9	\N	1	สุทธิพงษ์	\N	ทองดี	1	1	0	0	6	ถ.รัฐพัฒนา	\N	\N	7304	2567	101	2	2.59	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	6-1871-30149-98-5	\N	2	ปัณฑิตา	\N	บริบูรณ์	2	1	0	0	6	ถนนพหลโยธิน	\N	\N	7302	2556	423	2	2.04	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	1	10010008	6-3531-46095-21-7	\N	2	กุลธิดา	\N	ทั่วถึง	2	1	0	0	10	ถนนเยาวราช	\N	\N	7304	2559	113	3	3.39	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	4	10010008	5-7745-90481-25-5	\N	3	อัมพร	\N	เจริญชัย	2	1	0	0	3	ถนนโชคชัย	\N	\N	7304	2556	423	2	2.79	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	1	10010008	8-5310-35082-67-9	\N	2	พิมพ์ชนก	\N	สุขสบาย	2	1	0	0	5	ถ.บ้านโป่ง	\N	\N	7301	2562	106	1	3.52	10	นครปฐม	เมืองนครปฐม	พระปฐมเจดีย์
2569	1	2	10010008	4-3956-29302-51-9	\N	1	ภูมิพัฒน์	\N	งามดี	1	1	0	0	4	ถนนสีลม	\N	\N	7304	2564	104	3	3.66	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	2	10010008	6-1727-25152-53-5	\N	2	อัมพร	\N	อ่อนน้อม	2	1	0	0	2	ถ.เอกชัย	\N	\N	7302	2567	101	3	2.85	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	4	10010008	1-1585-12490-54-2	\N	3	จิราพร	\N	บริบูรณ์	2	1	0	0	2	ถนนเจริญกรุง	\N	\N	7304	2566	102	1	2.56	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010008	4-5937-76611-95-2	\N	3	รัตนาภรณ์	\N	กิตติคุณ	2	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	7302	2566	102	1	3.44	10	นครปฐม	เมืองนครปฐม	บางแขม
2569	1	2	10010008	6-6750-98614-77-1	\N	1	ธัชพล	\N	ชูศรี	1	1	0	0	1	ถนนโชคชัย	\N	\N	7304	2567	101	1	3.94	10	นครปฐม	เมืองนครปฐม	สามควายเผือก
2569	1	5	10010009	2-2831-67651-30-5	\N	1	วสันต์	\N	บุญรอด	1	1	0	0	10	ถนนเจริญกรุง	\N	\N	9203	2567	101	3	3.1	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	1-5106-23679-63-3	\N	3	มาลัย	\N	พงษ์ไพร	2	1	0	0	7	ถ.รัฐพัฒนา	\N	\N	9203	2563	105	2	2.75	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	1-2365-42321-28-2	\N	1	กันตภณ	\N	สุขสบาย	1	1	0	0	6	ถนนสุดสาคร	\N	\N	9204	2562	106	3	3.33	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	2-1118-45096-52-3	\N	2	ลลิตา	\N	ใจดี	2	1	0	0	1	ถ.เอกชัย	\N	\N	9201	2561	111	2	2.41	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	2-7514-14240-50-1	\N	1	คุณากร	\N	คงพิทักษ์	1	1	0	0	4	ถนนนิมมานเหมินท์	\N	\N	9201	2556	423	1	2.16	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	8-5206-21533-45-7	\N	2	ภัทรวดี	\N	ลือชา	2	1	0	0	6	ถนนกลางเมือง	\N	\N	9202	2558	421	1	3.88	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	6-6966-86940-19-7	\N	2	ชนิดา	\N	พรสวรรค์	2	1	0	0	5	ถนนบรมราชชนนี	\N	\N	9202	2557	422	1	3.87	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	4-4812-77178-62-5	\N	3	นวลจันทร์	\N	ประสิทธิ์ผล	2	1	0	0	9	ถนนสุดสาคร	\N	\N	9202	2567	103	3	2.55	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	2-1805-14527-48-2	\N	3	สมหญิง	\N	เกียรติสกุล	2	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	9201	2559	113	1	3.84	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	2-3592-94818-12-6	\N	2	ประภา	\N	พรประเสริฐ	2	1	0	0	1	ถนนเพชรเกษม	\N	\N	9203	2560	112	3	2.05	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	4-3197-82405-64-6	\N	2	สิริมา	\N	ดำรงค์	2	1	0	0	8	ถนนรามคำแหง	\N	\N	9202	2557	422	2	2.25	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	3-9369-37775-10-1	\N	1	อนุชา	\N	คงพิทักษ์	1	1	0	0	7	ถนนศรีนครินทร์	\N	\N	9202	2556	423	3	3.49	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	3-5395-57717-24-7	\N	1	ทัศนัย	\N	บุญรอด	1	1	0	0	8	ถนนบรมราชชนนี	\N	\N	9201	2558	421	1	3.82	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	1	10010009	2-2554-71911-28-3	\N	3	ลลิตา	\N	ศรีสุข	2	1	0	0	4	ถนนสีลม	\N	\N	9204	2564	104	2	3.32	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	6-5050-56166-65-3	\N	2	ดรุณี	\N	พงษ์ไพร	2	1	0	0	9	ถ.รัฐพัฒนา	\N	\N	9202	2567	101	1	2.62	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	1-5156-23569-44-8	\N	1	สมศักดิ์	\N	ขาวสะอาด	1	1	0	0	8	ถนนบรมราชชนนี	\N	\N	9203	2567	101	2	3.58	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	5-5676-60615-80-3	\N	2	กัญญา	\N	บุญรอด	2	1	0	0	2	ถนนสุดสาคร	\N	\N	9202	2564	104	3	3.37	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	5-8195-40236-28-3	\N	1	วีรชัย	\N	บุญมี	1	1	0	0	4	ถนนสรงประภา	\N	\N	9204	2567	103	1	3.14	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	4-7434-77167-20-3	\N	1	สิรภพ	\N	เพ็งพา	1	1	0	0	6	ถนนเยาวราช	\N	\N	9204	2567	103	2	3.97	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	5-8812-55504-88-1	\N	1	ศิวกร	\N	ชัยมงคล	1	1	0	0	5	ถนนเยาวราช	\N	\N	9202	2566	102	2	3.91	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	2-1057-55112-68-5	\N	2	วิมลรัตน์	\N	มีสุข	2	1	0	0	1	ถนนบายพาส	\N	\N	9204	2558	421	1	2.55	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	5-5897-45208-94-9	\N	3	ธัญชนก	\N	คงมั่น	2	1	0	0	4	ถนนกาญจนาภิเษก	\N	\N	9202	2559	113	1	3.26	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	8-8910-51698-43-8	\N	3	สุภัสสรา	\N	วิไลวรรณ	2	1	0	0	3	ถนนนวมินทร์	\N	\N	9201	2563	105	3	3.39	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	1	10010009	6-1008-23570-64-3	\N	1	เอกพงษ์	\N	วิไลวรรณ	1	1	0	0	3	ถนนสุขุมวิท	\N	\N	9204	2556	423	2	2.85	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	8-3703-46929-76-5	\N	3	กุลธิดา	\N	มีสุข	2	1	0	0	10	ถนนสรงประภา	\N	\N	9201	2560	112	3	3.73	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	1	10010009	3-1841-83357-16-9	\N	3	สุภัสสรา	\N	สมบูรณ์	2	1	0	0	3	ถนนสุขุมวิท	\N	\N	9202	2567	101	2	3.63	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	3-6839-33191-90-2	\N	2	นวลจันทร์	\N	คงพิทักษ์	2	1	0	0	1	ถนนกาญจนาภิเษก	\N	\N	9202	2566	102	1	3.37	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	4-1813-30554-72-3	\N	1	ชินดนัย	\N	ยิ้มแย้ม	1	1	0	0	10	ถนนพหลโยธิน	\N	\N	9203	2560	112	2	3.13	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	3-8851-88339-81-3	\N	1	ณัฐวุฒิ	\N	วงษ์สุวรรณ	1	1	0	0	6	ถ.รัฐพัฒนา	\N	\N	9201	2559	113	3	3.83	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	1-4801-33358-31-5	\N	1	ชาตรี	\N	ธนาคาร	1	1	0	0	1	ถนนประดิษฐ์มนูธรรม	\N	\N	9203	2560	112	1	2.86	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	2-9039-23867-54-1	\N	1	ชัยชนะ	\N	บริบูรณ์	1	1	0	0	7	ถนนนวมินทร์	\N	\N	9204	2561	111	1	2.62	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	6-3648-98428-16-9	\N	3	นันทพร	\N	เจริญชัย	2	1	0	0	6	ถนนรามคำแหง	\N	\N	9201	2562	106	3	3.78	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	8-5747-85739-45-2	\N	2	กัญญาณัฐ	\N	บุญมี	2	1	0	0	2	ถ.ประชาสามัคคี	\N	\N	9204	2561	111	1	2.24	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	8-5064-71765-26-6	\N	1	ประพันธ์	\N	ชูศรี	1	1	0	0	10	ถนนสุขุมวิท	\N	\N	9201	2559	113	2	2.59	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	5	10010009	4-5408-40049-99-3	\N	1	อภิวัฒน์	\N	วิไลวรรณ	1	1	0	0	10	ถ.ประชาสามัคคี	\N	\N	9204	2563	105	2	3.04	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	6-6308-73557-20-5	\N	3	สมหญิง	\N	ใจดี	2	1	0	0	8	ถ.บ้านโป่ง	\N	\N	9203	2560	112	3	3.72	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	5	10010009	1-4804-58038-34-4	\N	1	กิตติภณ	\N	บริบูรณ์	1	1	0	0	7	ถนนสีลม	\N	\N	9201	2556	423	1	3.48	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	6-2419-58870-51-9	\N	2	เพ็ญพักตร์	\N	ศรีสุข	2	1	0	0	9	ถนนอุดรดุษฎี	\N	\N	9204	2559	113	1	2.53	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	7-2800-18427-53-5	\N	2	นลินทิพย์	\N	เพียรดี	2	1	0	0	3	ถนนรามคำแหง	\N	\N	9203	2557	422	3	2.93	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	5-4654-21559-37-8	\N	1	วิชญ์พล	\N	ประสิทธิ์ผล	1	1	0	0	5	ถนนสุขุมวิท	\N	\N	9204	2564	104	2	3.19	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	7-5063-82775-31-3	\N	1	อนุชา	\N	วงษ์สุวรรณ	1	1	0	0	5	ถนนกาญจนาภิเษก	\N	\N	9201	2559	113	1	2.01	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	6-2315-97297-75-9	\N	1	ดิศรณ์	\N	เจริญชัย	1	1	0	0	2	ถ.บ้านโป่ง	\N	\N	9203	2561	111	3	3.68	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	7-1668-94077-37-5	\N	2	ชนิดา	\N	มีสุข	2	1	0	0	6	ถนนเยาวราช	\N	\N	9201	2559	113	2	3.75	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	1	10010009	2-1548-10752-63-6	\N	1	ภูมิพัฒน์	\N	พันธุ์ดี	1	1	0	0	7	ถนนนวมินทร์	\N	\N	9203	2558	421	3	2.09	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	8-3759-61033-59-5	\N	1	ไกรวุฒิ	\N	บุญรอด	1	1	0	0	1	ถนนสุรวงศ์	\N	\N	9202	2567	103	1	2.35	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	1-8055-46449-12-9	\N	1	กวินท์	\N	สุวรรณภูมิ	1	1	0	0	2	ถนนรัตนาธิเบศร์	\N	\N	9201	2564	104	3	3.67	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	2-1289-52734-87-3	\N	2	ลลิตา	\N	แสงสว่าง	2	1	0	0	1	ถนนนวมินทร์	\N	\N	9201	2558	421	3	2.75	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	6-9732-35650-86-4	\N	2	เกวลิน	\N	สีดา	2	1	0	0	2	ถนนเจริญกรุง	\N	\N	9204	2558	421	3	2.54	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	5-8573-76852-23-3	\N	3	สุมาลี	\N	เจริญชัย	2	1	0	0	7	ถนนเจริญกรุง	\N	\N	9203	2560	112	3	3.93	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	8-1652-92336-37-1	\N	1	ธนภัทร	\N	ลือชา	1	1	0	0	8	ถนนเจริญกรุง	\N	\N	9204	2560	112	1	2.12	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	3-6358-53963-77-9	\N	1	เจษฎา	\N	ทั่วถึง	1	1	0	0	2	ถนนบรมราชชนนี	\N	\N	9204	2566	102	1	3.95	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	6-2562-81502-13-8	\N	1	ดิศรณ์	\N	ทั่วถึง	1	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	9204	2562	106	2	2.2	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	1-2001-43287-94-3	\N	3	อรณิชา	\N	เจริญชัย	2	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	9204	2566	102	3	3.69	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	6-9930-49495-66-6	\N	3	ชนิดา	\N	วงษ์สุวรรณ	2	1	0	0	2	ถนนสุดสาคร	\N	\N	9202	2558	421	2	2.6	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	1-1351-53873-48-5	\N	1	สิรภพ	\N	ดำรงค์	1	1	0	0	5	ถนนอุดรดุษฎี	\N	\N	9201	2567	101	3	3.56	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	4-8483-38454-84-1	\N	1	ชัยชนะ	\N	ทั่วถึง	1	1	0	0	8	ถนนสุดสาคร	\N	\N	9203	2563	105	1	2.84	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	3-1231-41537-23-6	\N	3	วันวิสา	\N	กิตติคุณ	2	1	0	0	8	ถ.บ้านโป่ง	\N	\N	9203	2566	102	2	3.47	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	1-8746-67365-80-4	\N	1	ธัชพล	\N	สุวรรณภูมิ	1	1	0	0	7	ถนนสีลม	\N	\N	9201	2560	112	1	2.55	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	1	10010009	3-8528-25697-63-7	\N	3	ปัณฑิตา	\N	ทั่วถึง	2	1	0	0	3	ถนนสาทร	\N	\N	9201	2560	112	3	2.28	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	1	10010009	8-3840-64612-53-6	\N	1	สมชาย	\N	สมบูรณ์	1	1	0	0	9	ถนนงามวงศ์วาน	\N	\N	9204	2562	106	1	2.92	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	5-3237-69296-10-2	\N	1	ปรเมศวร์	\N	ธนาคาร	1	1	0	0	9	ถนนสรงประภา	\N	\N	9204	2562	106	1	2.67	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	4-1705-46098-61-8	\N	1	ชินดนัย	\N	อ่อนน้อม	1	1	0	0	5	ถนนสุขุมวิท	\N	\N	9202	2566	102	1	2.75	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	5-9308-38825-51-7	\N	3	ภัทรวดี	\N	อินทร์ชัย	2	1	0	0	3	ถนนประดิษฐ์มนูธรรม	\N	\N	9202	2564	104	1	2.81	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	4-4895-59636-46-3	\N	2	เกวลิน	\N	สุจริต	2	1	0	0	2	ถนนมิตรภาพ	\N	\N	9201	2557	422	2	3.09	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	8-2034-59572-59-4	\N	1	สมศักดิ์	\N	ชูศรี	1	1	0	0	10	ถนนสาทร	\N	\N	9204	2564	104	2	3.91	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	1-8640-10409-22-9	\N	1	นรวิชญ์	\N	บุญมี	1	1	0	0	3	ถนนบรมราชชนนี	\N	\N	9202	2556	423	2	3.52	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	2-9924-81584-34-4	\N	3	เกวลิน	\N	หอมหวาน	2	1	0	0	5	ถนนพหลโยธิน	\N	\N	9201	2561	111	2	2.38	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	3-4410-10762-16-3	\N	3	สุภัสสรา	\N	ชัยมงคล	2	1	0	0	3	ถนนวิภาวดีรังสิต	\N	\N	9204	2556	423	3	3.44	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	5-4735-38469-94-4	\N	1	ปรเมศวร์	\N	อินทร์ชัย	1	1	0	0	6	ถนนบรมราชชนนี	\N	\N	9204	2557	422	2	3.98	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	6-4046-94973-15-5	\N	1	ณัฐวรรธน์	\N	สง่างาม	1	1	0	0	10	ถนนช้างเผือก	\N	\N	9203	2564	104	1	2.29	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	6-4449-71889-97-3	\N	3	สุนิสา	\N	วังขวา	2	1	0	0	3	ถ.รัฐพัฒนา	\N	\N	9203	2567	101	1	2.8	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	3-6038-45108-77-9	\N	1	สุทธิพงษ์	\N	สมบูรณ์	1	1	0	0	9	ถนนสุขุมวิท	\N	\N	9201	2564	104	2	3.62	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	4-6775-88134-31-9	\N	3	สุนิสา	\N	สุวรรณภูมิ	2	1	0	0	10	ถนนเพชรเกษม	\N	\N	9204	2556	423	2	2.63	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	6-4874-43969-68-5	\N	2	อัมพร	\N	งามดี	2	1	0	0	10	ถนนงามวงศ์วาน	\N	\N	9201	2561	111	3	3.59	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	2-3590-29005-30-4	\N	1	ธัชพล	\N	ทองดี	1	1	0	0	5	ถนนกาญจนาภิเษก	\N	\N	9203	2567	101	3	3.52	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	5	10010009	7-6085-49480-52-2	\N	3	อภิญญา	\N	ธนาคาร	2	1	0	0	5	ถนนศรีนครินทร์	\N	\N	9203	2563	105	2	3.05	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	2-5206-27367-58-1	\N	1	วสันต์	\N	เกียรติสกุล	1	1	0	0	8	ถนนงามวงศ์วาน	\N	\N	9204	2559	113	3	3.49	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	3-8220-62850-46-7	\N	1	ชินดนัย	\N	ธนาคาร	1	1	0	0	2	ถนนสรงประภา	\N	\N	9201	2567	101	1	3.86	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	3-6489-84855-24-4	\N	1	วรพล	\N	คงพิทักษ์	1	1	0	0	8	ถนนศรีนครินทร์	\N	\N	9203	2564	104	2	2.86	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	4-1987-91291-96-8	\N	1	รชานนท์	\N	ธนาคาร	1	1	0	0	9	ถนนสุขุมวิท	\N	\N	9204	2557	422	3	3.72	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	3-1833-72767-53-4	\N	1	ทักษิณ	\N	นิ่มนวล	1	1	0	0	10	ถนนรามคำแหง	\N	\N	9202	2563	105	2	3.12	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	2-9357-37625-51-1	\N	1	ทัศนัย	\N	เพียรดี	1	1	0	0	8	ถนนสุรวงศ์	\N	\N	9202	2562	106	1	3.03	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	2-6664-22310-97-2	\N	3	บุษยา	\N	ชัยมงคล	2	1	0	0	5	ถนนมาลัยแมน	\N	\N	9201	2560	112	1	2.78	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	2-8691-61468-30-8	\N	1	เจษฎา	\N	วิริยะ	1	1	0	0	3	ถนนนิมมานเหมินท์	\N	\N	9203	2564	104	3	2.93	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	7-6749-20916-44-8	\N	1	ธนพัฒน์	\N	สุขสันต์	1	1	0	0	6	ถนนสาทร	\N	\N	9201	2567	101	2	3.81	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	5-6266-52510-46-6	\N	1	วรากร	\N	พันธุ์ดี	1	1	0	0	1	ถนนบรมราชชนนี	\N	\N	9203	2566	102	3	2.82	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	5-2640-36800-20-3	\N	1	ชัยชนะ	\N	รักษ์ไทย	1	1	0	0	1	ถนนมิตรภาพ	\N	\N	9202	2567	103	3	3.95	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	3-3482-15188-31-5	\N	1	ณัฐพล	\N	ศักดิ์สิทธิ์	1	1	0	0	2	ถ.บ้านโป่ง	\N	\N	9202	2558	421	3	3.4	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	3-3697-59564-62-8	\N	3	สุนิสา	\N	ทองดี	2	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	9204	2556	423	1	3.39	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	5-7709-34285-56-6	\N	1	บุญยิ่ง	\N	สุขสบาย	1	1	0	0	10	ถนนสุขุมวิท	\N	\N	9204	2556	423	1	2.66	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	1-2936-31206-53-4	\N	1	อภิวัฒน์	\N	วงษ์สุวรรณ	1	1	0	0	5	ถนนอ่อนนุช	\N	\N	9202	2563	105	2	3.83	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	7-8791-93188-52-7	\N	3	สุมาลี	\N	เจริญชัย	2	1	0	0	5	ถนนวิภาวดีรังสิต	\N	\N	9204	2559	113	1	2.93	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	2-2213-91207-43-6	\N	1	นรวิชญ์	\N	ยิ้มแย้ม	1	1	0	0	8	ถนนศรีนครินทร์	\N	\N	9201	2560	112	3	2.35	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	6-6763-51577-10-3	\N	1	สมชาย	\N	เกียรติสกุล	1	1	0	0	7	ถนนวิภาวดีรังสิต	\N	\N	9203	2566	102	1	2.65	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	3-9239-46952-84-4	\N	3	พิมพ์ชนก	\N	พรประเสริฐ	2	1	0	0	10	ถนนชัยพฤกษ์	\N	\N	9202	2566	102	1	3.19	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	3-9687-55152-46-5	\N	2	นภาพร	\N	จันทร์แก้ว	2	1	0	0	4	ถนนลาดพร้าว	\N	\N	9201	2567	101	3	3.52	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	1	10010009	2-8080-40612-93-8	\N	2	ธัญชนก	\N	ทั่วถึง	2	1	0	0	1	ถ.รัฐพัฒนา	\N	\N	9204	2567	103	2	3.76	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	6-1867-34013-93-5	\N	1	วุฒิพงษ์	\N	หอมหวาน	1	1	0	0	1	ถ.ประชาสามัคคี	\N	\N	9202	2559	113	1	3.75	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	1-5302-76560-57-2	\N	1	ไกรวุฒิ	\N	มีสุข	1	1	0	0	6	ถนนสุขุมวิท	\N	\N	9204	2567	103	3	3.72	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	1-6051-23729-49-8	\N	2	ปาณิสรา	\N	ปัญญาดี	2	1	0	0	2	ถนนเยาวราช	\N	\N	9203	2567	103	2	3.14	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	2-6296-62505-88-3	\N	1	ณัฐวรรธน์	\N	วิริยะ	1	1	0	0	3	ถนนรามคำแหง	\N	\N	9204	2563	105	3	3.52	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	5-1225-50390-99-8	\N	1	เจษฎา	\N	ยิ้มแย้ม	1	1	0	0	7	ถนนสุรวงศ์	\N	\N	9201	2567	103	2	3.2	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	5-2678-51214-93-3	\N	1	ธนภัทร	\N	สง่างาม	1	1	0	0	9	ถนนนิมมานเหมินท์	\N	\N	9203	2562	106	3	3.19	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	6-4965-68275-45-7	\N	1	เจษฎา	\N	เจริญชัย	1	1	0	0	7	ถ.ประชาสามัคคี	\N	\N	9204	2559	113	2	2.2	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	7-2115-95597-24-2	\N	2	สุนิสา	\N	สุจริต	2	1	0	0	7	ถนนเจริญกรุง	\N	\N	9204	2561	111	2	2.73	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	8-5928-74315-80-3	\N	3	มาลัย	\N	บุญมี	2	1	0	0	6	ถนนมาลัยแมน	\N	\N	9203	2563	105	2	2.24	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	2-2341-13548-31-9	\N	1	กันตภณ	\N	สีดา	1	1	0	0	9	ถนนอ่อนนุช	\N	\N	9202	2559	113	2	2.18	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	2-3117-15956-20-8	\N	1	กันตภณ	\N	ดำรงค์	1	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	9201	2567	103	1	2.3	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	5	10010009	5-3121-34748-74-1	\N	2	ดวงใจ	\N	วิไลวรรณ	2	1	0	0	3	ถนนงามวงศ์วาน	\N	\N	9204	2561	111	2	2.37	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	1-9160-15662-84-3	\N	1	สิรภพ	\N	วิไลวรรณ	1	1	0	0	8	ถนนเจริญกรุง	\N	\N	9202	2558	421	2	3.5	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	6-5497-33391-96-5	\N	3	ลลิตา	\N	สีดา	2	1	0	0	8	ถนนรัตนาธิเบศร์	\N	\N	9202	2559	113	3	2.58	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	7-8149-89502-90-3	\N	1	วีรชัย	\N	นิ่มนวล	1	1	0	0	1	ถ.เอกชัย	\N	\N	9201	2566	102	3	2.94	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	8-1417-76685-62-4	\N	1	สุทธิพงษ์	\N	บริบูรณ์	1	1	0	0	4	ถนนนิมมานเหมินท์	\N	\N	9202	2562	106	1	3.4	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	1-4295-77318-51-7	\N	2	มณีรัตน์	\N	ชูศรี	2	1	0	0	10	ถนนโชคชัย	\N	\N	9204	2567	103	1	3.19	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	3-8384-77834-35-7	\N	1	ปรเมศวร์	\N	ศักดิ์สิทธิ์	1	1	0	0	3	ถนนบายพาส	\N	\N	9203	2567	101	1	3.9	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	5-8466-52764-20-6	\N	3	เพ็ญพักตร์	\N	จันทร์แก้ว	2	1	0	0	4	ถ.บ้านโป่ง	\N	\N	9203	2566	102	3	2.58	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	3-5081-99582-76-3	\N	1	ธัชพล	\N	ยิ้มแย้ม	1	1	0	0	1	ถนนสุขุมวิท	\N	\N	9201	2562	106	1	3.79	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	5	10010009	7-8892-82386-27-5	\N	1	ณัฐวรรธน์	\N	ยิ้มแย้ม	1	1	0	0	7	ถนนห้วยแก้ว	\N	\N	9202	2566	102	2	3.3	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	2-3093-77373-80-2	\N	2	กุลธิดา	\N	นิ่มนวล	2	1	0	0	7	ถนนสุขุมวิท	\N	\N	9202	2561	111	1	3.91	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	4-3726-74865-28-4	\N	1	ณัฐวุฒิ	\N	ปัญญาดี	1	1	0	0	5	ถนนเยาวราช	\N	\N	9202	2567	103	3	3.81	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	2-5166-81208-84-5	\N	1	กันตภณ	\N	ใจดี	1	1	0	0	9	ถนนราษฎร์บูรณะ	\N	\N	9204	2562	106	3	2.43	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	5-7962-61798-25-8	\N	1	นรวิชญ์	\N	สุจริต	1	1	0	0	2	ถนนลาดพร้าว	\N	\N	9202	2561	111	1	3.1	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	2-4930-94301-39-8	\N	1	ชูเกียรติ	\N	วิริยะ	1	1	0	0	6	ถนนศรีนครินทร์	\N	\N	9204	2559	113	1	3.87	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	3-3528-72662-13-1	\N	1	ชูเกียรติ	\N	หอมหวาน	1	1	0	0	5	ถนนเจริญกรุง	\N	\N	9203	2567	103	2	2.66	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	8-4287-14173-37-8	\N	3	ปาณิสรา	\N	เพ็งพา	2	1	0	0	5	ถนนโชคชัย	\N	\N	9202	2561	111	3	3.43	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	3-1825-16843-61-1	\N	2	นวลจันทร์	\N	พรประเสริฐ	2	1	0	0	9	ถนนสุรวงศ์	\N	\N	9202	2562	106	2	3.69	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	7-8913-57635-74-6	\N	1	วสันต์	\N	บริบูรณ์	1	1	0	0	10	ถนนเจริญกรุง	\N	\N	9204	2560	112	2	3.49	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	6-4643-75737-37-8	\N	2	ศิริพร	\N	สีดา	2	1	0	0	10	ถนนลาดพร้าว	\N	\N	9203	2558	421	1	2.45	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	5-8512-59783-23-3	\N	1	ปัณณทัต	\N	บุญรอด	1	1	0	0	8	ถนนเจริญกรุง	\N	\N	9203	2560	112	2	2.87	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	3-5585-80904-14-6	\N	1	อภิวัฒน์	\N	ทั่วถึง	1	1	0	0	3	ถนนราษฎร์บูรณะ	\N	\N	9201	2559	113	3	3.26	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	8-5021-68538-29-1	\N	2	รุ่งอรุณ	\N	งามดี	2	1	0	0	2	ถ.เอกชัย	\N	\N	9204	2558	421	2	2.23	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	7-8449-70243-47-8	\N	1	วรากร	\N	ศรีสุข	1	1	0	0	4	ถนนกลางเมือง	\N	\N	9204	2561	111	3	2.79	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	1-9043-26313-99-7	\N	1	กิตติภณ	\N	รุ่งเรือง	1	1	0	0	8	ถ.บ้านโป่ง	\N	\N	9204	2563	105	2	2.52	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	4-1031-11272-81-4	\N	1	ปัณณทัต	\N	มณีรัตน์	1	1	0	0	4	ถนนนิมมานเหมินท์	\N	\N	9202	2561	111	3	3.73	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	1-4210-90875-90-4	\N	1	ปิยังกูร	\N	ลือชา	1	1	0	0	1	ถนนสีลม	\N	\N	9201	2563	105	3	2.63	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	4-8225-38841-23-3	\N	1	ชินดนัย	\N	งามดี	1	1	0	0	10	ถนนกลางเมือง	\N	\N	9203	2567	101	1	2.66	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	5	10010009	6-8577-39920-27-3	\N	1	ชูเกียรติ	\N	นามมนตรี	1	1	0	0	10	ถนนสรงประภา	\N	\N	9201	2560	112	3	3	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	5	10010009	7-4451-85753-22-1	\N	2	ปิยนุช	\N	นิ่มนวล	2	1	0	0	7	ถนนศรีนครินทร์	\N	\N	9202	2558	421	1	3.77	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	1-4646-81151-18-7	\N	1	กันตภณ	\N	สกุลดี	1	1	0	0	10	ถนนงามวงศ์วาน	\N	\N	9204	2559	113	2	3.82	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	7-5200-45725-45-2	\N	3	บุษยา	\N	ลือชา	2	1	0	0	2	ถนนนวมินทร์	\N	\N	9201	2564	104	3	2.88	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	3-6290-53809-68-4	\N	2	กัญญาณัฐ	\N	จันทร์แก้ว	2	1	0	0	1	ถนนเพชรเกษม	\N	\N	9203	2563	105	3	2.33	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	4-1270-27199-30-8	\N	1	คุณากร	\N	กิตติคุณ	1	1	0	0	3	ถ.บ้านโป่ง	\N	\N	9202	2566	102	3	2.95	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	3-4954-19049-25-5	\N	2	รัตนาภรณ์	\N	สุจริต	2	1	0	0	4	ถนนวิภาวดีรังสิต	\N	\N	9203	2557	422	2	3.56	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	8-8194-57892-84-8	\N	1	วรพล	\N	เจริญชัย	1	1	0	0	3	ถ.รัฐพัฒนา	\N	\N	9204	2566	102	3	2.74	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	5-7456-53432-91-8	\N	2	พรรษา	\N	อ่อนน้อม	2	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	9203	2566	102	1	3.03	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	5	10010009	7-5756-62500-30-3	\N	2	บุษยา	\N	หอมหวาน	2	1	0	0	10	ถนนบรมราชชนนี	\N	\N	9204	2562	106	3	2.98	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	1-9908-18437-20-1	\N	2	กาญจนา	\N	เจริญชัย	2	1	0	0	1	ถนนลาดพร้าว	\N	\N	9201	2556	423	1	3.51	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	1	10010009	3-7694-36654-71-5	\N	3	ดวงใจ	\N	บุญรอด	2	1	0	0	2	ถนนนวมินทร์	\N	\N	9202	2557	422	3	3.66	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	2-4258-40262-89-3	\N	2	แสงดาว	\N	คงมั่น	2	1	0	0	3	ถ.เอกชัย	\N	\N	9202	2567	101	2	2.58	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	5-8900-31011-66-9	\N	3	นวลจันทร์	\N	เกียรติสกุล	2	1	0	0	8	ถนนศรีนครินทร์	\N	\N	9203	2557	422	3	3.94	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	7-7421-83145-59-8	\N	3	วิมลรัตน์	\N	ปัญญาดี	2	1	0	0	10	ถนนเยาวราช	\N	\N	9204	2564	104	2	2.76	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	3-4130-69328-58-2	\N	1	ธนภัทร	\N	สุจริต	1	1	0	0	9	ถนนสรงประภา	\N	\N	9204	2567	103	1	3.05	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	2-3896-75575-19-3	\N	2	สุมาลี	\N	มณีรัตน์	2	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	9204	2567	103	2	3.21	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	1-3834-60957-31-3	\N	3	สิริมา	\N	พรสวรรค์	2	1	0	0	6	ถนนเพชรเกษม	\N	\N	9201	2560	112	2	2.96	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	5-4765-73868-96-3	\N	1	ชินดนัย	\N	วิไลวรรณ	1	1	0	0	9	ถนนศรีนครินทร์	\N	\N	9204	2562	106	3	3.73	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	4-4050-16103-82-2	\N	2	ณัฐนิชา	\N	เพ็งพา	2	1	0	0	9	ถนนราษฎร์บูรณะ	\N	\N	9203	2558	421	1	2.09	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	5	10010009	7-8642-77249-36-1	\N	1	อภิวัฒน์	\N	พันธุ์ดี	1	1	0	0	4	ถนนเพชรเกษม	\N	\N	9204	2563	105	2	3.32	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	8-7813-99419-78-5	\N	3	รัตนาภรณ์	\N	แสงสว่าง	2	1	0	0	9	ถนนรามคำแหง	\N	\N	9202	2567	101	2	2.62	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	2-5760-52773-18-3	\N	2	วันวิสา	\N	วังขวา	2	1	0	0	1	ถนนโชคชัย	\N	\N	9204	2562	106	3	3.23	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	5-1642-58917-61-9	\N	3	เพ็ญพักตร์	\N	สุวรรณภูมิ	2	1	0	0	5	ถนนมิตรภาพ	\N	\N	9202	2561	111	2	2.36	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	6-3860-81932-67-8	\N	1	อนุชา	\N	หอมหวาน	1	1	0	0	3	ถนนสรงประภา	\N	\N	9201	2558	421	1	3.67	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	2-3564-34202-70-3	\N	3	กาญจนา	\N	แสงสว่าง	2	1	0	0	6	ถนนกาญจนาภิเษก	\N	\N	9202	2563	105	2	3.23	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	6-9943-27368-52-5	\N	3	แสงดาว	\N	วิไลวรรณ	2	1	0	0	7	ถ.เอกชัย	\N	\N	9201	2563	105	3	2.03	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	4-1179-68170-50-2	\N	2	นันทพร	\N	นิ่มนวล	2	1	0	0	7	ถนนอ่อนนุช	\N	\N	9204	2567	101	3	3.23	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	5-1213-89807-98-1	\N	1	ธัชพล	\N	สกุลดี	1	1	0	0	8	ถนนสาทร	\N	\N	9202	2560	112	2	3.24	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	1-4563-62424-18-5	\N	2	สุมาลี	\N	เพ็งพา	2	1	0	0	6	ถนนนิมมานเหมินท์	\N	\N	9201	2562	106	2	2.55	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	5	10010009	1-6323-78496-45-9	\N	2	ณัฐนิชา	\N	คงพิทักษ์	2	1	0	0	5	ถนนงามวงศ์วาน	\N	\N	9201	2567	101	2	3.07	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	5	10010009	7-1556-27532-27-4	\N	2	ดรุณี	\N	พรสวรรค์	2	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	9202	2566	102	1	3.76	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	7-4975-80821-15-6	\N	1	บุญยิ่ง	\N	กิตติคุณ	1	1	0	0	9	ถนนเยาวราช	\N	\N	9203	2556	423	3	2.81	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	2-8977-59097-87-4	\N	3	ปัณฑิตา	\N	สุขสบาย	2	1	0	0	2	ถ.ประชาสามัคคี	\N	\N	9203	2567	101	2	3.51	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	5	10010009	6-7505-36343-92-2	\N	1	ภัคพล	\N	ใจดี	1	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	9201	2566	102	3	3.74	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	1	10010009	8-6900-53910-74-6	\N	2	ภัทรวดี	\N	รุ่งเรือง	2	1	0	0	4	ถ.เอกชัย	\N	\N	9203	2556	423	3	3.07	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	5	10010009	7-6407-20230-23-9	\N	2	บุษยา	\N	สกุลดี	2	1	0	0	9	ถนนประดิษฐ์มนูธรรม	\N	\N	9204	2567	101	3	2.56	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	8-9337-52328-47-6	\N	3	วิมลรัตน์	\N	วังขวา	2	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	9204	2557	422	1	2.17	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	6-6558-82366-74-4	\N	3	แสงดาว	\N	มณีรัตน์	2	1	0	0	5	ถนนนวมินทร์	\N	\N	9204	2567	103	3	3.59	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	5-2348-19297-51-7	\N	3	สุนิสา	\N	งามดี	2	1	0	0	6	ถนนชัยพฤกษ์	\N	\N	9202	2567	103	2	3.47	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	2-9844-17449-57-3	\N	2	พรรษา	\N	วงษ์สุวรรณ	2	1	0	0	8	ถนนชัยพฤกษ์	\N	\N	9203	2556	423	1	2.78	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	2-7920-46383-62-1	\N	1	กิตติภณ	\N	ศักดิ์สิทธิ์	1	1	0	0	7	ถนนสุดสาคร	\N	\N	9203	2567	103	2	2.63	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	4-9441-78251-35-4	\N	2	ดรุณี	\N	เพ็งพา	2	1	0	0	4	ถนนบรมราชชนนี	\N	\N	9202	2566	102	2	2.99	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	3-9219-92598-32-1	\N	2	มาลัย	\N	อ่อนน้อม	2	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	9202	2557	422	2	3.02	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	2-1572-84369-12-1	\N	2	ชนิดา	\N	หอมหวาน	2	1	0	0	3	ถนนนวมินทร์	\N	\N	9204	2557	422	2	3.83	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	7-7706-21801-69-9	\N	1	ธนภัทร	\N	ทองดี	1	1	0	0	1	ถนนโชคชัย	\N	\N	9201	2564	104	1	3.55	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	8-7782-55309-10-3	\N	3	ปาณิสรา	\N	สุดสวย	2	1	0	0	10	ถนนวิภาวดีรังสิต	\N	\N	9201	2566	102	1	3.93	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	2-6923-36388-57-4	\N	1	สมชาย	\N	แสงสว่าง	1	1	0	0	8	ถนนห้วยแก้ว	\N	\N	9201	2556	423	1	3.63	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	2-7159-31917-46-3	\N	1	สุรชัย	\N	ใจดี	1	1	0	0	10	ถนนอ่อนนุช	\N	\N	9204	2566	102	3	3.09	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	1-2893-67478-69-5	\N	1	คุณากร	\N	มณีรัตน์	1	1	0	0	5	ถนนสุดสาคร	\N	\N	9201	2567	101	2	3.82	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	5	10010009	2-8985-52393-11-8	\N	1	ปิยังกูร	\N	อินทร์ชัย	1	1	0	0	9	ถนนอ่อนนุช	\N	\N	9203	2561	111	2	2.68	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	4-5468-88452-73-7	\N	1	ปรเมศวร์	\N	คงมั่น	1	1	0	0	3	ถนนเพชรเกษม	\N	\N	9202	2567	103	2	3.74	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	5-2744-59777-45-9	\N	2	วิมลรัตน์	\N	ยิ้มแย้ม	2	1	0	0	7	ถนนบายพาส	\N	\N	9201	2561	111	2	2.83	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	7-1526-30887-77-5	\N	1	ชินดนัย	\N	นิ่มนวล	1	1	0	0	10	ถนนมาลัยแมน	\N	\N	9204	2566	102	3	2.7	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	2-5301-98702-85-6	\N	1	ประพันธ์	\N	เกียรติสกุล	1	1	0	0	3	ถนนห้วยแก้ว	\N	\N	9203	2561	111	1	2.45	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	7-6976-45596-82-8	\N	1	ชาตรี	\N	ดำรงค์	1	1	0	0	1	ถนนช้างเผือก	\N	\N	9203	2557	422	1	2.17	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	2-1074-27933-14-4	\N	3	ปาณิสรา	\N	สุจริต	2	1	0	0	9	ถนนนวมินทร์	\N	\N	9201	2563	105	2	2.3	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	3-2092-28506-22-1	\N	3	พิมพ์ชนก	\N	ใจดี	2	1	0	0	1	ถนนวิภาวดีรังสิต	\N	\N	9202	2566	102	1	3.77	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	1-9622-47278-80-7	\N	3	บุษยา	\N	คงพิทักษ์	2	1	0	0	6	ถนนนิมมานเหมินท์	\N	\N	9204	2562	106	1	2.16	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	3-3995-31678-89-1	\N	1	สมชาย	\N	สุจริต	1	1	0	0	6	ถนนกาญจนาภิเษก	\N	\N	9203	2557	422	3	3.03	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	3-4547-94492-62-1	\N	3	ภัทรวดี	\N	วงษ์สุวรรณ	2	1	0	0	8	ถนนพหลโยธิน	\N	\N	9201	2562	106	2	3	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	4-6468-20829-69-6	\N	3	ปาณิสรา	\N	รักษ์ไทย	2	1	0	0	3	ถนนรัตนาธิเบศร์	\N	\N	9202	2567	103	3	3.93	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	1-8318-61214-26-8	\N	3	พรรษา	\N	มณีรัตน์	2	1	0	0	4	ถนนราษฎร์บูรณะ	\N	\N	9201	2561	111	3	2.55	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	4-3555-61728-30-3	\N	2	เกวลิน	\N	บุญรอด	2	1	0	0	6	ถนนรัตนาธิเบศร์	\N	\N	9202	2559	113	3	2.61	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	3-4799-10372-19-5	\N	3	สิริมา	\N	พรประเสริฐ	2	1	0	0	7	ถนนเยาวราช	\N	\N	9202	2558	421	1	3.8	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	6-5835-21152-79-6	\N	3	กาญจนา	\N	สง่างาม	2	1	0	0	3	ถนนรัตนาธิเบศร์	\N	\N	9201	2564	104	3	2.3	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	1	10010009	1-5526-45442-37-4	\N	1	มานพ	\N	กิตติคุณ	1	1	0	0	1	ถนนกลางเมือง	\N	\N	9201	2561	111	1	3.45	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	5	10010009	4-5164-15377-94-7	\N	1	มานพ	\N	บุญรอด	1	1	0	0	1	ถนนรัตนาธิเบศร์	\N	\N	9201	2561	111	3	3.81	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	5-3547-31333-54-3	\N	3	จิราพร	\N	เพียรดี	2	1	0	0	8	ถ.ประชาสามัคคี	\N	\N	9204	2558	421	2	3.04	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	5-6107-28552-84-3	\N	3	ปิยนุช	\N	บริบูรณ์	2	1	0	0	8	ถ.บ้านโป่ง	\N	\N	9203	2557	422	3	2.87	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	7-8229-50912-88-5	\N	2	ณัฐนิชา	\N	คงพิทักษ์	2	1	0	0	3	ถนนศรีนครินทร์	\N	\N	9202	2567	103	2	2.43	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	6-3862-35021-75-2	\N	1	ศุภณัฐ	\N	สกุลดี	1	1	0	0	5	ถนนประดิษฐ์มนูธรรม	\N	\N	9204	2562	106	3	3.92	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	8-8363-91634-38-2	\N	3	ชลธิชา	\N	สมบูรณ์	2	1	0	0	3	ถนนเยาวราช	\N	\N	9201	2561	111	3	2.77	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	5	10010009	4-7144-29208-39-2	\N	1	ศิวกร	\N	ชูศรี	1	1	0	0	8	ถนนช้างเผือก	\N	\N	9202	2566	102	2	3.57	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	8-8666-95220-65-4	\N	2	สิริมา	\N	สีดา	2	1	0	0	1	ถนนอุดรดุษฎี	\N	\N	9204	2564	104	3	2.74	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	5-7363-91529-85-2	\N	3	บุษยา	\N	วิริยะ	2	1	0	0	6	ถนนประดิษฐ์มนูธรรม	\N	\N	9202	2562	106	2	3.98	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	2-5396-97731-96-5	\N	2	พรทิพย์	\N	ยิ้มแย้ม	2	1	0	0	3	ถนนเจริญกรุง	\N	\N	9202	2562	106	3	3.85	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	8-6132-13091-50-7	\N	1	รชานนท์	\N	บุญรอด	1	1	0	0	2	ถนนเพชรเกษม	\N	\N	9204	2560	112	1	3.25	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	2-9539-62614-87-7	\N	3	มณีรัตน์	\N	พรสวรรค์	2	1	0	0	2	ถนนบรมราชชนนี	\N	\N	9201	2557	422	2	3.86	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	5-4049-17898-59-1	\N	1	ชัยชนะ	\N	ศรีสุข	1	1	0	0	6	ถนนงามวงศ์วาน	\N	\N	9203	2567	101	1	3.47	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	5-5043-53738-29-7	\N	1	ธัชพล	\N	นิ่มนวล	1	1	0	0	9	ถนนสรงประภา	\N	\N	9204	2559	113	3	2.02	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	1-3146-97311-41-3	\N	1	ไกรวุฒิ	\N	ปัญญาดี	1	1	0	0	8	ถนนเพชรเกษม	\N	\N	9203	2564	104	1	3.25	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	6-3295-25784-33-4	\N	1	อนุชา	\N	ลือชา	1	1	0	0	1	ถนนอ่อนนุช	\N	\N	9202	2559	113	2	3.9	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	2-8255-28045-20-1	\N	2	วาสนา	\N	วิไลวรรณ	2	1	0	0	5	ถนนสุดสาคร	\N	\N	9204	2557	422	1	3.99	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	8-1264-95452-18-9	\N	1	ชูเกียรติ	\N	ปัญญาดี	1	1	0	0	8	ถนนนวมินทร์	\N	\N	9201	2564	104	3	3.45	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	4-2789-81726-23-4	\N	1	สมชาย	\N	มณีรัตน์	1	1	0	0	2	ถนนชัยพฤกษ์	\N	\N	9203	2557	422	2	2.72	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	4-6863-95365-12-6	\N	3	วิมลรัตน์	\N	สุขสบาย	2	1	0	0	5	ถนนพหลโยธิน	\N	\N	9204	2559	113	2	3.65	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	7-3128-92567-85-5	\N	3	สุนิสา	\N	งามดี	2	1	0	0	4	ถนนมาลัยแมน	\N	\N	9204	2560	112	3	3.11	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	5-1136-71409-27-1	\N	1	ชินดนัย	\N	วงษ์สุวรรณ	1	1	0	0	8	ถนนนวมินทร์	\N	\N	9203	2559	113	1	3.51	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	3-3165-31183-66-8	\N	3	สุมาลี	\N	เพียรดี	2	1	0	0	7	ถนนพหลโยธิน	\N	\N	9203	2567	103	3	2.74	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	3-6500-33178-67-4	\N	1	ชนะชัย	\N	ศักดิ์สิทธิ์	1	1	0	0	5	ถนนเยาวราช	\N	\N	9201	2567	101	2	3.81	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	3-2070-11018-81-4	\N	2	มณีรัตน์	\N	วังขวา	2	1	0	0	1	ถนนมาลัยแมน	\N	\N	9201	2560	112	2	2.98	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	1-9500-43580-31-6	\N	1	วรพล	\N	นามมนตรี	1	1	0	0	8	ถนนมิตรภาพ	\N	\N	9203	2564	104	3	3.08	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	8-3057-50828-76-7	\N	2	ธัญชนก	\N	บริบูรณ์	2	1	0	0	9	ถนนโชคชัย	\N	\N	9202	2558	421	1	3.38	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	3-8328-68450-43-7	\N	1	ดิศรณ์	\N	เพ็งพา	1	1	0	0	10	ถนนพหลโยธิน	\N	\N	9203	2563	105	2	2.05	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	8-1155-54498-77-8	\N	1	วิชญ์พล	\N	พรประเสริฐ	1	1	0	0	8	ถนนช้างเผือก	\N	\N	9203	2566	102	1	2.83	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	1-6003-11600-91-3	\N	1	ดิศรณ์	\N	สมบูรณ์	1	1	0	0	4	ถนนกาญจนาภิเษก	\N	\N	9201	2564	104	3	3.83	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	5	10010009	5-7110-37550-55-1	\N	1	ณัฐพล	\N	ดีสมัย	1	1	0	0	1	ถนนสรงประภา	\N	\N	9202	2556	423	2	3.28	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	7-7807-84165-45-4	\N	1	ณัฐวุฒิ	\N	เพียรดี	1	1	0	0	7	ถนนช้างเผือก	\N	\N	9204	2567	101	3	2.8	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	6-2871-38816-92-5	\N	3	สุมาลี	\N	นิ่มนวล	2	1	0	0	5	ถนนห้วยแก้ว	\N	\N	9201	2562	106	3	2.96	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	6-6105-30468-79-4	\N	2	นลินทิพย์	\N	คงพิทักษ์	2	1	0	0	2	ถนนโชคชัย	\N	\N	9204	2563	105	2	2.38	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	3-9391-14546-87-2	\N	3	ภัทรวดี	\N	รุ่งเรือง	2	1	0	0	2	ถนนช้างเผือก	\N	\N	9204	2566	102	1	3.72	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	8-1093-56692-96-5	\N	2	สุมาลี	\N	เจริญชัย	2	1	0	0	10	ถนนรามคำแหง	\N	\N	9202	2562	106	3	3.59	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	5-9094-62001-55-2	\N	1	ณัฐวรรธน์	\N	สุจริต	1	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	9203	2557	422	2	2.74	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	6-2660-36254-75-4	\N	3	แสงดาว	\N	คงพิทักษ์	2	1	0	0	5	ถนนกลางเมือง	\N	\N	9201	2558	421	2	3.61	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	5	10010009	6-2779-53864-98-9	\N	2	รัตนาภรณ์	\N	อินทร์ชัย	2	1	0	0	3	ถนนชัยพฤกษ์	\N	\N	9203	2556	423	2	2.84	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	7-8331-63514-56-7	\N	1	ณัฐพล	\N	คงพิทักษ์	1	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	9203	2564	104	2	2.27	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	8-7298-86211-36-9	\N	2	ดรุณี	\N	อินทร์ชัย	2	1	0	0	10	ถนนชัยพฤกษ์	\N	\N	9203	2559	113	1	2.62	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	8-4493-54412-91-3	\N	2	แสงดาว	\N	มงคล	2	1	0	0	10	ถนนรัตนาธิเบศร์	\N	\N	9201	2558	421	3	3.19	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	7-8334-44593-43-8	\N	1	ศุภณัฐ	\N	งามดี	1	1	0	0	9	ถนนอุดรดุษฎี	\N	\N	9201	2564	104	3	3.39	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	1	10010009	2-7617-90889-42-5	\N	2	กุลธิดา	\N	สุขสบาย	2	1	0	0	2	ถนนประดิษฐ์มนูธรรม	\N	\N	9204	2562	106	3	2.17	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	8-1931-24929-53-4	\N	1	ธัชพล	\N	งามดี	1	1	0	0	10	ถนนประดิษฐ์มนูธรรม	\N	\N	9204	2560	112	3	3.43	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	5-9752-92953-50-2	\N	2	อภิญญา	\N	สุวรรณภูมิ	2	1	0	0	2	ถ.เอกชัย	\N	\N	9203	2560	112	3	2.13	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	5-1466-48881-55-2	\N	3	รัตนาภรณ์	\N	วงษ์สุวรรณ	2	1	0	0	3	ถนนราษฎร์บูรณะ	\N	\N	9203	2559	113	1	3.79	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	4-6663-69361-97-5	\N	2	วาสนา	\N	อ่อนน้อม	2	1	0	0	4	ถนนบรมราชชนนี	\N	\N	9204	2558	421	3	2.23	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	1-2974-29752-79-6	\N	1	กิตติภณ	\N	มณีรัตน์	1	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	9203	2559	113	1	2.51	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	2-1129-82562-65-7	\N	1	ธัชพล	\N	สง่างาม	1	1	0	0	8	ถนนรัตนาธิเบศร์	\N	\N	9202	2562	106	3	2.67	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	4-6278-46529-95-1	\N	2	แสงดาว	\N	ทั่วถึง	2	1	0	0	7	ถนนกาญจนาภิเษก	\N	\N	9203	2564	104	3	2.23	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	5-9729-75893-72-7	\N	1	เอกพงษ์	\N	อ่อนน้อม	1	1	0	0	10	ถนนบรมราชชนนี	\N	\N	9202	2566	102	2	3.35	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	7-1572-55897-87-4	\N	3	วิมลรัตน์	\N	ใจดี	2	1	0	0	8	ถนนลาดพร้าว	\N	\N	9202	2564	104	1	2.63	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	4-7251-21686-24-4	\N	3	นันทพร	\N	รักษ์ไทย	2	1	0	0	9	ถนนนวมินทร์	\N	\N	9202	2564	104	1	2.9	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	5-9150-58985-48-9	\N	3	วรรณภา	\N	ลือชา	2	1	0	0	8	ถนนลาดพร้าว	\N	\N	9201	2566	102	1	3.76	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	5-9428-42087-75-6	\N	1	สุทธิพงษ์	\N	สกุลดี	1	1	0	0	7	ถนนลาดพร้าว	\N	\N	9203	2559	113	1	2.53	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	5	10010009	7-8446-67601-77-6	\N	1	ภัคพล	\N	พรสวรรค์	1	1	0	0	4	ถนนสรงประภา	\N	\N	9204	2563	105	2	3.11	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	4-7401-19938-88-4	\N	3	เพ็ญพักตร์	\N	สง่างาม	2	1	0	0	3	ถนนบายพาส	\N	\N	9203	2557	422	3	2.42	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	8-5675-27363-34-7	\N	1	ปัณณทัต	\N	ธนาคาร	1	1	0	0	9	ถนนอ่อนนุช	\N	\N	9204	2558	421	3	2.74	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	7-6274-80536-79-1	\N	2	วันวิสา	\N	สุจริต	2	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	9202	2562	106	1	2.93	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	7-6202-66898-59-4	\N	2	สุภัสสรา	\N	ทองดี	2	1	0	0	7	ถนนสาทร	\N	\N	9203	2562	106	2	2.6	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	1-5655-33996-22-1	\N	2	กุลธิดา	\N	คงมั่น	2	1	0	0	4	ถ.บ้านโป่ง	\N	\N	9202	2558	421	1	2.42	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	8-1752-22126-32-4	\N	1	ภูมิพัฒน์	\N	ขาวสะอาด	1	1	0	0	4	ถนนช้างเผือก	\N	\N	9204	2564	104	3	3.53	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	1-2323-33426-86-3	\N	2	ดวงใจ	\N	ทั่วถึง	2	1	0	0	10	ถนนสรงประภา	\N	\N	9204	2558	421	3	3.47	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	5-6260-72167-44-1	\N	1	ภูมิพัฒน์	\N	ใจดี	1	1	0	0	9	ถนนห้วยแก้ว	\N	\N	9202	2557	422	2	2.03	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	2-4700-89165-29-9	\N	1	วรพล	\N	ลือชา	1	1	0	0	3	ถนนอ่อนนุช	\N	\N	9203	2567	101	3	2.62	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	5	10010009	3-8088-83526-38-2	\N	3	มาลัย	\N	ทั่วถึง	2	1	0	0	4	ถนนประดิษฐ์มนูธรรม	\N	\N	9203	2567	103	1	3.18	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	4-8105-69767-35-7	\N	1	อนุชา	\N	มณีรัตน์	1	1	0	0	2	ถนนนิมมานเหมินท์	\N	\N	9202	2559	113	3	2.4	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	6-7891-21433-95-6	\N	1	ศิวกร	\N	กิตติคุณ	1	1	0	0	9	ถนนเพชรเกษม	\N	\N	9204	2564	104	3	2.72	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	5-3476-85825-33-3	\N	1	ชัยชนะ	\N	ใจดี	1	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	9201	2556	423	3	3.91	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	1-9484-19836-10-8	\N	3	วันวิสา	\N	วังขวา	2	1	0	0	3	ถนนสีลม	\N	\N	9202	2558	421	1	2.13	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	8-9500-41065-14-2	\N	1	วรพล	\N	พรสวรรค์	1	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	9202	2557	422	2	3.99	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	6-5065-73669-47-3	\N	2	สุภัสสรา	\N	วิริยะ	2	1	0	0	5	ถนนนิมมานเหมินท์	\N	\N	9202	2564	104	2	2.65	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	8-1709-30354-37-3	\N	1	วุฒิพงษ์	\N	วิริยะ	1	1	0	0	9	ถนนอ่อนนุช	\N	\N	9203	2556	423	2	2.95	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	2-1173-48293-92-4	\N	1	ณัฐพล	\N	คงพิทักษ์	1	1	0	0	10	ถ.ประชาสามัคคี	\N	\N	9201	2558	421	2	3.83	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	1	10010009	3-5928-28918-54-1	\N	1	ปัณณทัต	\N	ขาวสะอาด	1	1	0	0	6	ถนนบายพาส	\N	\N	9201	2566	102	3	3.62	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	5-5613-18681-80-8	\N	1	ชนะชัย	\N	แสงสว่าง	1	1	0	0	8	ถนนอุดรดุษฎี	\N	\N	9204	2564	104	2	3.71	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	3-1325-49503-31-8	\N	3	กัญญาณัฐ	\N	สกุลดี	2	1	0	0	6	ถนนนวมินทร์	\N	\N	9204	2567	103	3	3.92	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	3-6637-87634-91-3	\N	1	ณัฐพล	\N	วงษ์สุวรรณ	1	1	0	0	4	ถนนรัตนาธิเบศร์	\N	\N	9203	2559	113	1	3.44	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	6-2947-51940-29-9	\N	2	มณีรัตน์	\N	ศรีสุข	2	1	0	0	9	ถนนสุขุมวิท	\N	\N	9204	2558	421	3	2.32	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	1-7117-15646-74-5	\N	1	พิพัฒน์	\N	คงพิทักษ์	1	1	0	0	10	ถนนช้างเผือก	\N	\N	9204	2567	101	2	2.91	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	5-8853-37614-12-9	\N	1	สุรชัย	\N	ทั่วถึง	1	1	0	0	8	ถนนประดิษฐ์มนูธรรม	\N	\N	9201	2563	105	1	3.61	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	5-5842-25159-39-4	\N	2	เกวลิน	\N	เจริญชัย	2	1	0	0	4	ถนนห้วยแก้ว	\N	\N	9202	2557	422	1	3.74	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	8-1246-13682-28-4	\N	1	ธนาธิป	\N	สุจริต	1	1	0	0	4	ถนนห้วยแก้ว	\N	\N	9201	2566	102	1	3.22	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	2-7062-72044-16-9	\N	1	ชินดนัย	\N	ชัยมงคล	1	1	0	0	9	ถนนอ่อนนุช	\N	\N	9201	2567	103	1	3.04	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	5-4682-54786-45-4	\N	1	ธนพัฒน์	\N	ประสิทธิ์ผล	1	1	0	0	5	ถนนรามคำแหง	\N	\N	9201	2559	113	1	2.76	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	7-5834-40490-35-4	\N	1	พิพัฒน์	\N	ปัญญาดี	1	1	0	0	1	ถนนกาญจนาภิเษก	\N	\N	9203	2566	102	2	3.59	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	5	10010009	6-9413-55850-40-6	\N	1	นรวิชญ์	\N	ทองดี	1	1	0	0	1	ถนนอุดรดุษฎี	\N	\N	9203	2563	105	1	3	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	5	10010009	5-2032-84632-93-5	\N	1	ไกรวุฒิ	\N	รักษ์ไทย	1	1	0	0	4	ถ.ประชาสามัคคี	\N	\N	9203	2557	422	3	2.07	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	7-6781-54074-61-9	\N	1	ปัณณทัต	\N	คงมั่น	1	1	0	0	6	ถนนรัตนาธิเบศร์	\N	\N	9201	2564	104	3	3.77	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	5-9125-98366-96-3	\N	1	ปรเมศวร์	\N	สุขสบาย	1	1	0	0	8	ถนนกลางเมือง	\N	\N	9201	2564	104	1	3.18	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	4-7057-87879-22-5	\N	1	นรวิชญ์	\N	มงคล	1	1	0	0	7	ถนนรามคำแหง	\N	\N	9202	2559	113	2	2.65	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	4-5498-12388-10-8	\N	1	กิตติภณ	\N	ศรีสุข	1	1	0	0	8	ถนนงามวงศ์วาน	\N	\N	9203	2567	103	3	3.02	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	5	10010009	4-2798-67840-40-5	\N	2	สมหญิง	\N	จันทร์แก้ว	2	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	9201	2566	102	3	3.71	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	4-8605-52003-35-2	\N	1	ธนาธิป	\N	จันทร์แก้ว	1	1	0	0	8	ถนนห้วยแก้ว	\N	\N	9203	2561	111	1	3.37	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	1-1770-14313-27-6	\N	1	ปิยังกูร	\N	เจริญชัย	1	1	0	0	10	ถนนอ่อนนุช	\N	\N	9201	2567	101	3	2.74	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	5	10010009	1-4031-29055-81-8	\N	3	จันทร์เพ็ญ	\N	มงคล	2	1	0	0	5	ถนนพหลโยธิน	\N	\N	9201	2556	423	1	2.69	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	1-3622-66861-49-3	\N	3	ทิพย์สุดา	\N	วังขวา	2	1	0	0	2	ถนนนิมมานเหมินท์	\N	\N	9203	2567	103	1	2.82	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	5-5676-74383-69-3	\N	1	ปิยังกูร	\N	วังขวา	1	1	0	0	8	ถนนมาลัยแมน	\N	\N	9203	2558	421	2	3.44	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	2-7010-95194-69-1	\N	1	ทักษิณ	\N	เพียรดี	1	1	0	0	5	ถนนมิตรภาพ	\N	\N	9202	2558	421	2	2.74	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	5-2828-57404-82-9	\N	1	เอกพงษ์	\N	ทั่วถึง	1	1	0	0	9	ถนนชัยพฤกษ์	\N	\N	9202	2564	104	2	2.59	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	4-2825-44492-90-1	\N	3	ปิยนุช	\N	พันธุ์ดี	2	1	0	0	3	ถนนสุขุมวิท	\N	\N	9203	2561	111	1	3.41	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	2-2903-94265-48-1	\N	1	ภูมิพัฒน์	\N	แสงสว่าง	1	1	0	0	8	ถนนมิตรภาพ	\N	\N	9201	2560	112	1	3.21	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	4-5134-76316-49-5	\N	3	ดรุณี	\N	บุญรอด	2	1	0	0	4	ถนนรัตนาธิเบศร์	\N	\N	9204	2564	104	1	3.73	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	3-4755-82693-28-9	\N	3	สิริมา	\N	หอมหวาน	2	1	0	0	9	ถนนประดิษฐ์มนูธรรม	\N	\N	9204	2561	111	2	2.24	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	6-9444-80173-13-8	\N	1	ธัชพล	\N	วงษ์สุวรรณ	1	1	0	0	4	ถนนชัยพฤกษ์	\N	\N	9202	2562	106	3	2.17	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	5-8123-78126-63-4	\N	3	สุภัสสรา	\N	เจริญชัย	2	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	9202	2567	103	2	2.73	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	3-3077-73105-17-5	\N	1	ณัฐพล	\N	คงมั่น	1	1	0	0	10	ถนนเยาวราช	\N	\N	9202	2558	421	3	2.45	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	6-6303-90882-33-5	\N	1	ปรเมศวร์	\N	ลือชา	1	1	0	0	6	ถนนประดิษฐ์มนูธรรม	\N	\N	9203	2567	103	1	2.88	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	6-5577-80300-13-6	\N	1	ดิศรณ์	\N	พงษ์ไพร	1	1	0	0	2	ถนนเยาวราช	\N	\N	9202	2563	105	1	3.02	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	5-1755-86846-83-5	\N	1	บุญยิ่ง	\N	พรประเสริฐ	1	1	0	0	5	ถ.บ้านโป่ง	\N	\N	9202	2567	103	1	3.08	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	1-7659-29632-19-5	\N	1	ปิยังกูร	\N	อ่อนน้อม	1	1	0	0	7	ถนนเพชรเกษม	\N	\N	9201	2556	423	1	2.59	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	4-8734-17709-31-6	\N	1	นรวิชญ์	\N	สุวรรณภูมิ	1	1	0	0	6	ถนนมิตรภาพ	\N	\N	9203	2564	104	1	3.63	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	6-8591-69560-95-2	\N	3	กุลธิดา	\N	ยิ้มแย้ม	2	1	0	0	9	ถนนรัตนาธิเบศร์	\N	\N	9201	2560	112	1	3.71	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	5	10010009	3-9723-93130-56-2	\N	2	ปาณิสรา	\N	รักษ์ไทย	2	1	0	0	5	ถนนเพชรเกษม	\N	\N	9202	2563	105	2	2.83	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	8-5508-58908-62-6	\N	1	ธนพัฒน์	\N	งามดี	1	1	0	0	10	ถนนชัยพฤกษ์	\N	\N	9202	2561	111	2	2.77	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	4-7807-47810-35-6	\N	3	ณัฐนิชา	\N	สกุลดี	2	1	0	0	4	ถ.บ้านโป่ง	\N	\N	9202	2559	113	2	3.66	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	1-1950-89660-52-9	\N	1	ธนาธิป	\N	จันทร์แก้ว	1	1	0	0	4	ถนนสุขุมวิท	\N	\N	9203	2564	104	1	2.3	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	7-6881-51916-73-5	\N	3	รัตนาภรณ์	\N	คงมั่น	2	1	0	0	8	ถนนเยาวราช	\N	\N	9202	2562	106	1	2.1	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	3-2628-62435-12-9	\N	2	จิตรลดา	\N	ประสิทธิ์ผล	2	1	0	0	4	ถนนนิมมานเหมินท์	\N	\N	9204	2564	104	1	2.79	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	4-5366-90353-98-7	\N	1	ดิศรณ์	\N	สุขสันต์	1	1	0	0	5	ถ.เอกชัย	\N	\N	9204	2557	422	1	3.24	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	6-5768-29602-63-3	\N	1	ประพันธ์	\N	อินทร์ชัย	1	1	0	0	7	ถ.รัฐพัฒนา	\N	\N	9203	2560	112	1	3.6	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	2-4416-66509-18-2	\N	1	คุณากร	\N	บุญรอด	1	1	0	0	7	ถนนบายพาส	\N	\N	9202	2556	423	3	2.96	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	8-8337-55706-85-5	\N	2	พรทิพย์	\N	ธนาคาร	2	1	0	0	2	ถนนนิมมานเหมินท์	\N	\N	9202	2564	104	3	3.53	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	4-8248-60765-85-8	\N	3	ศิริพร	\N	ทั่วถึง	2	1	0	0	10	ถนนเพชรเกษม	\N	\N	9202	2566	102	2	3.01	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	1-7568-38938-14-1	\N	3	อรณิชา	\N	ประสิทธิ์ผล	2	1	0	0	8	ถนนเจริญกรุง	\N	\N	9202	2562	106	1	3.15	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	8-9193-74309-36-6	\N	1	นรวิชญ์	\N	วังขวา	1	1	0	0	7	ถนนสีลม	\N	\N	9202	2567	101	3	3.81	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	3-7276-94241-83-9	\N	1	วรากร	\N	จันทร์แก้ว	1	1	0	0	8	ถ.ประชาสามัคคี	\N	\N	9204	2567	101	1	3.61	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	8-4476-49175-48-7	\N	1	ชาตรี	\N	ทั่วถึง	1	1	0	0	9	ถนนช้างเผือก	\N	\N	9201	2556	423	2	3.69	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	8-3681-86731-39-7	\N	1	กิตติภณ	\N	นิ่มนวล	1	1	0	0	2	ถนนบายพาส	\N	\N	9203	2563	105	3	3.35	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	5	10010009	7-4806-94856-64-8	\N	2	นันทพร	\N	บุญรอด	2	1	0	0	8	ถนนอุดรดุษฎี	\N	\N	9204	2567	103	1	3.23	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	4-7603-11503-12-8	\N	1	ทักษิณ	\N	เจริญชัย	1	1	0	0	6	ถนนกลางเมือง	\N	\N	9204	2557	422	2	2.26	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	8-9233-80390-97-7	\N	2	นันทพร	\N	สุขสบาย	2	1	0	0	2	ถนนเจริญกรุง	\N	\N	9204	2559	113	1	3.97	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	3-1060-27184-81-1	\N	1	ประพันธ์	\N	รุ่งเรือง	1	1	0	0	3	ถนนราษฎร์บูรณะ	\N	\N	9201	2559	113	2	2.52	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	7-6337-22122-70-6	\N	1	ณัฐวรรธน์	\N	ขาวสะอาด	1	1	0	0	9	ถนนอุดรดุษฎี	\N	\N	9203	2567	103	2	2.35	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	5-4578-81367-77-4	\N	2	สุนิสา	\N	มงคล	2	1	0	0	4	ถนนศรีนครินทร์	\N	\N	9204	2558	421	2	3.63	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	2-4067-61823-86-2	\N	1	ณัฐวรรธน์	\N	สีดา	1	1	0	0	8	ถนนสุดสาคร	\N	\N	9203	2563	105	3	3.16	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	6-5290-17245-96-8	\N	3	ดรุณี	\N	มีสุข	2	1	0	0	1	ถนนห้วยแก้ว	\N	\N	9204	2566	102	1	3.17	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	7-6363-28569-85-7	\N	2	พรรษา	\N	แสงสว่าง	2	1	0	0	8	ถนนเยาวราช	\N	\N	9202	2560	112	2	3.7	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	4-2875-16031-13-2	\N	2	สุภัสสรา	\N	สุดสวย	2	1	0	0	8	ถ.เอกชัย	\N	\N	9204	2556	423	3	2.09	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	1-5095-66372-49-3	\N	3	จิราพร	\N	เพียรดี	2	1	0	0	4	ถนนโชคชัย	\N	\N	9201	2559	113	1	2.32	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	5-2661-31652-43-6	\N	1	ปรเมศวร์	\N	พงษ์ไพร	1	1	0	0	7	ถนนศรีนครินทร์	\N	\N	9203	2567	101	1	2.71	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	1-5138-23881-20-4	\N	1	อภิวัฒน์	\N	ทั่วถึง	1	1	0	0	10	ถนนสุดสาคร	\N	\N	9201	2556	423	2	2.52	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	7-6234-64489-88-9	\N	3	ปาณิสรา	\N	เพ็งพา	2	1	0	0	4	ถนนมาลัยแมน	\N	\N	9203	2563	105	1	2.89	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	8-7074-98660-72-3	\N	3	จิตรลดา	\N	มณีรัตน์	2	1	0	0	1	ถนนอ่อนนุช	\N	\N	9202	2566	102	1	3.27	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	4-3905-76872-74-6	\N	1	ศิวกร	\N	สุดสวย	1	1	0	0	9	ถนนวิภาวดีรังสิต	\N	\N	9202	2556	423	2	2.2	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	8-2170-17847-43-5	\N	2	ปัณฑิตา	\N	รุ่งเรือง	2	1	0	0	10	ถนนรัตนาธิเบศร์	\N	\N	9201	2561	111	3	2.43	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	1-7307-79799-77-8	\N	2	ภัทรวดี	\N	อินทร์ชัย	2	1	0	0	9	ถนนห้วยแก้ว	\N	\N	9204	2563	105	2	3.08	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	8-1609-54085-34-9	\N	1	ชินดนัย	\N	คงพิทักษ์	1	1	0	0	8	ถนนช้างเผือก	\N	\N	9201	2556	423	3	3.6	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	3-8397-94067-16-4	\N	1	วรพล	\N	สุดสวย	1	1	0	0	10	ถ.รัฐพัฒนา	\N	\N	9203	2563	105	3	3.52	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	5-4173-31625-93-7	\N	2	กุลธิดา	\N	วิริยะ	2	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	9201	2562	106	2	3.81	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	1-1549-99526-80-7	\N	2	สุภัสสรา	\N	ปัญญาดี	2	1	0	0	6	ถนนนวมินทร์	\N	\N	9203	2563	105	1	3.63	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	5	10010009	4-5888-31917-21-2	\N	2	ธัญชนก	\N	อินทร์ชัย	2	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	9203	2561	111	2	3.14	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	2-5101-24287-52-7	\N	3	จิราพร	\N	วิไลวรรณ	2	1	0	0	2	ถ.รัฐพัฒนา	\N	\N	9204	2557	422	1	3.4	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	8-3520-43120-70-7	\N	1	ศุภณัฐ	\N	สมบูรณ์	1	1	0	0	2	ถ.รัฐพัฒนา	\N	\N	9203	2566	102	1	2.67	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	7-9531-45506-25-8	\N	2	วรรณภา	\N	วิไลวรรณ	2	1	0	0	3	ถ.บ้านโป่ง	\N	\N	9202	2563	105	1	3.54	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	5-2915-39776-33-7	\N	1	กันตภณ	\N	แสงสว่าง	1	1	0	0	4	ถนนพหลโยธิน	\N	\N	9204	2561	111	2	3.66	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	1-3484-28951-19-4	\N	1	ณัฐวุฒิ	\N	แสงสว่าง	1	1	0	0	4	ถ.รัฐพัฒนา	\N	\N	9202	2562	106	3	3.01	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	7-1263-75042-31-5	\N	1	สิรภพ	\N	เพียรดี	1	1	0	0	4	ถนนลาดพร้าว	\N	\N	9203	2560	112	1	3.3	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	6-2914-90581-66-3	\N	3	อรณิชา	\N	ดีสมัย	2	1	0	0	9	ถนนช้างเผือก	\N	\N	9203	2556	423	1	2.28	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	1-3530-71976-75-7	\N	3	บุษยา	\N	กิตติคุณ	2	1	0	0	4	ถนนวิภาวดีรังสิต	\N	\N	9202	2559	113	2	3.81	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	1-7688-89449-54-6	\N	3	สุนิสา	\N	สีดา	2	1	0	0	3	ถนนรามคำแหง	\N	\N	9204	2560	112	1	3.06	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	2-6475-60114-60-8	\N	1	กิตติภณ	\N	สุดสวย	1	1	0	0	9	ถนนช้างเผือก	\N	\N	9203	2564	104	1	2.92	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	3-3415-92823-78-9	\N	2	ประภา	\N	คงมั่น	2	1	0	0	2	ถนนพหลโยธิน	\N	\N	9203	2566	102	1	4	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	7-6235-56883-47-6	\N	2	รัตนาภรณ์	\N	ศักดิ์สิทธิ์	2	1	0	0	1	ถนนโชคชัย	\N	\N	9203	2563	105	2	2.9	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	5	10010009	1-7340-85200-16-5	\N	3	ชนิดา	\N	บุญรอด	2	1	0	0	4	ถนนประดิษฐ์มนูธรรม	\N	\N	9203	2563	105	3	3.71	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	3-7359-85993-14-6	\N	3	วาสนา	\N	นิ่มนวล	2	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	9203	2567	101	1	3.09	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	1-4069-10116-73-8	\N	1	สมชาย	\N	สุจริต	1	1	0	0	8	ถนนอ่อนนุช	\N	\N	9202	2562	106	3	3.05	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	4-4387-36586-59-8	\N	1	ปิยังกูร	\N	วิริยะ	1	1	0	0	8	ถนนรัตนาธิเบศร์	\N	\N	9201	2557	422	1	2.04	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	2-3362-68834-85-2	\N	3	นันทพร	\N	ชูศรี	2	1	0	0	4	ถนนชัยพฤกษ์	\N	\N	9202	2563	105	1	3.08	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	5-1284-49823-20-7	\N	2	พรทิพย์	\N	บุญมี	2	1	0	0	3	ถ.บ้านโป่ง	\N	\N	9203	2562	106	3	3.02	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	6-5932-95376-44-5	\N	2	ธัญชนก	\N	จันทร์แก้ว	2	1	0	0	9	ถนนมิตรภาพ	\N	\N	9202	2561	111	1	3.54	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	2-7371-79999-21-1	\N	1	อภิวัฒน์	\N	สุจริต	1	1	0	0	8	ถนนเพชรเกษม	\N	\N	9203	2556	423	3	2.15	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	6-2561-49784-91-7	\N	1	สุรชัย	\N	กิตติคุณ	1	1	0	0	1	ถ.ประชาสามัคคี	\N	\N	9204	2558	421	1	3.88	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	3-5888-11184-46-5	\N	1	วุฒิพงษ์	\N	สมบูรณ์	1	1	0	0	1	ถนนเพชรเกษม	\N	\N	9201	2556	423	1	2.49	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	4-6085-36212-61-2	\N	1	วรากร	\N	มีสุข	1	1	0	0	5	ถนนช้างเผือก	\N	\N	9203	2560	112	3	3.99	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	3-9665-66984-78-7	\N	2	ปัณฑิตา	\N	เพ็งพา	2	1	0	0	7	ถ.รัฐพัฒนา	\N	\N	9201	2561	111	1	2.35	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	5	10010009	4-7271-41729-36-3	\N	3	มณีรัตน์	\N	พันธุ์ดี	2	1	0	0	1	ถนนวิภาวดีรังสิต	\N	\N	9204	2567	101	3	3.66	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	1-9603-71883-14-2	\N	1	รชานนท์	\N	วิริยะ	1	1	0	0	5	ถนนบายพาส	\N	\N	9203	2556	423	1	3.77	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	4-3120-44935-59-8	\N	1	ธนพัฒน์	\N	ลือชา	1	1	0	0	9	ถนนสีลม	\N	\N	9201	2567	103	2	3.46	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	1-9325-77797-32-4	\N	1	พิพัฒน์	\N	สุดสวย	1	1	0	0	3	ถนนเยาวราช	\N	\N	9204	2567	101	1	3	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	8-4489-29466-41-8	\N	1	ทักษิณ	\N	รุ่งเรือง	1	1	0	0	3	ถนนเยาวราช	\N	\N	9204	2557	422	3	3.34	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	1-7445-19426-76-7	\N	1	ไกรวุฒิ	\N	เพ็งพา	1	1	0	0	10	ถนนวิภาวดีรังสิต	\N	\N	9201	2561	111	1	2.45	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	1-7003-63302-89-6	\N	3	ณัฐนิชา	\N	ประสิทธิ์ผล	2	1	0	0	9	ถนนราษฎร์บูรณะ	\N	\N	9202	2567	101	2	3.88	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	2-3558-54429-81-1	\N	3	กัญญาณัฐ	\N	ทั่วถึง	2	1	0	0	3	ถนนห้วยแก้ว	\N	\N	9201	2567	101	2	3.95	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	5-5867-17640-48-3	\N	2	รัตนาภรณ์	\N	คงพิทักษ์	2	1	0	0	5	ถนนเพชรเกษม	\N	\N	9204	2557	422	2	2.87	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	7-1897-43604-61-5	\N	3	นันทพร	\N	วิไลวรรณ	2	1	0	0	4	ถนนสุขุมวิท	\N	\N	9204	2563	105	2	2.14	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	1-6848-38560-19-4	\N	1	กวินท์	\N	เพ็งพา	1	1	0	0	10	ถ.เอกชัย	\N	\N	9203	2556	423	2	3.79	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	4-9076-71919-71-3	\N	1	เจษฎา	\N	พันธุ์ดี	1	1	0	0	5	ถนนศรีนครินทร์	\N	\N	9204	2560	112	2	3.59	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	8-7753-23891-27-9	\N	3	รัตนาภรณ์	\N	วิริยะ	2	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	9203	2567	101	1	3.77	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	5-9274-19602-84-5	\N	1	ดิศรณ์	\N	นามมนตรี	1	1	0	0	1	ถนนมาลัยแมน	\N	\N	9204	2560	112	3	3.13	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	1-5821-14825-81-7	\N	1	ธนาธิป	\N	มงคล	1	1	0	0	8	ถนนอ่อนนุช	\N	\N	9204	2567	101	2	3.95	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	1-7200-30934-45-8	\N	1	ณัฐวุฒิ	\N	ธนาคาร	1	1	0	0	2	ถนนบายพาส	\N	\N	9204	2567	103	2	3.14	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	1-6509-44450-24-6	\N	2	จิราพร	\N	ยิ้มแย้ม	2	1	0	0	3	ถนนโชคชัย	\N	\N	9204	2560	112	1	3.86	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	1-2860-65093-84-7	\N	1	วรพล	\N	ลือชา	1	1	0	0	3	ถนนสุขุมวิท	\N	\N	9204	2558	421	2	3.53	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	1-7554-58650-41-9	\N	1	บุญยิ่ง	\N	พงษ์ไพร	1	1	0	0	2	ถนนสาทร	\N	\N	9202	2566	102	1	3.24	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	4-6987-95166-18-3	\N	3	บุษยา	\N	เจริญชัย	2	1	0	0	10	ถนนสุขุมวิท	\N	\N	9202	2558	421	2	2.59	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	1-6563-15125-17-5	\N	3	ทิพย์สุดา	\N	อินทร์ชัย	2	1	0	0	6	ถนนบรมราชชนนี	\N	\N	9203	2563	105	2	2.28	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	1-6172-84549-30-5	\N	1	วรพล	\N	ประสิทธิ์ผล	1	1	0	0	4	ถนนโชคชัย	\N	\N	9204	2556	423	1	2.75	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	8-1918-32093-24-2	\N	1	ชาตรี	\N	พรประเสริฐ	1	1	0	0	7	ถนนนวมินทร์	\N	\N	9202	2560	112	1	3.89	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	7-6732-66950-94-2	\N	2	จิราพร	\N	เพ็งพา	2	1	0	0	8	ถนนประดิษฐ์มนูธรรม	\N	\N	9202	2567	103	1	2.66	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	7-2420-19036-50-4	\N	1	ทัศนัย	\N	เกียรติสกุล	1	1	0	0	9	ถนนสีลม	\N	\N	9203	2557	422	3	2.38	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	8-5619-39977-16-4	\N	1	วีรชัย	\N	เจริญชัย	1	1	0	0	5	ถนนชัยพฤกษ์	\N	\N	9203	2561	111	3	2.55	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	2-2784-53134-54-7	\N	3	พรรษา	\N	พรสวรรค์	2	1	0	0	9	ถนนงามวงศ์วาน	\N	\N	9203	2567	101	2	3.6	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	7-7840-13599-19-8	\N	3	พิมพ์ชนก	\N	ขาวสะอาด	2	1	0	0	9	ถนนราษฎร์บูรณะ	\N	\N	9201	2566	102	2	3.27	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	1-3448-69820-86-8	\N	3	ภัทรวดี	\N	ทั่วถึง	2	1	0	0	3	ถ.บ้านโป่ง	\N	\N	9204	2567	103	1	3.01	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	6-3498-23853-70-5	\N	1	ธนภัทร	\N	ศรีสุข	1	1	0	0	6	ถนนสุดสาคร	\N	\N	9204	2559	113	3	2.61	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	4-1369-97535-60-9	\N	3	กัญญา	\N	ดีสมัย	2	1	0	0	5	ถนนเพชรเกษม	\N	\N	9204	2561	111	2	3.69	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	8-4227-82472-18-6	\N	3	ทิพย์สุดา	\N	ดำรงค์	2	1	0	0	7	ถ.ประชาสามัคคี	\N	\N	9203	2558	421	3	3.62	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	1-3049-92197-39-3	\N	2	นวลจันทร์	\N	พรประเสริฐ	2	1	0	0	8	ถนนสุดสาคร	\N	\N	9201	2557	422	2	2.17	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	5	10010009	8-4377-85738-67-7	\N	1	ไกรวุฒิ	\N	วงษ์สุวรรณ	1	1	0	0	9	ถ.รัฐพัฒนา	\N	\N	9204	2566	102	2	3.67	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	2-8902-56713-39-5	\N	3	ทิพย์สุดา	\N	พันธุ์ดี	2	1	0	0	1	ถนนอุดรดุษฎี	\N	\N	9204	2556	423	3	3.58	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	8-6178-64941-37-5	\N	1	วสันต์	\N	ดำรงค์	1	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	9204	2562	106	1	2.17	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	3-8099-90599-63-7	\N	2	วรรณภา	\N	ศรีสุข	2	1	0	0	8	ถนนราษฎร์บูรณะ	\N	\N	9201	2567	101	1	3.83	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	8-4267-18536-82-7	\N	2	วาสนา	\N	คงมั่น	2	1	0	0	9	ถนนศรีนครินทร์	\N	\N	9202	2567	101	2	3.88	10	ตรัง	เมืองตรัง	นาพละ
2569	1	2	10010009	8-8352-30703-64-8	\N	3	กุลธิดา	\N	ชูศรี	2	1	0	0	2	ถนนกลางเมือง	\N	\N	9201	2557	422	1	2.09	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	4-5186-99882-55-5	\N	2	มาลัย	\N	ยิ้มแย้ม	2	1	0	0	2	ถนนบายพาส	\N	\N	9203	2560	112	1	2.15	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	7-6689-31739-80-6	\N	2	นภาพร	\N	กิตติคุณ	2	1	0	0	4	ถนนรัตนาธิเบศร์	\N	\N	9201	2567	103	1	2.2	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	7-9748-53985-89-3	\N	1	สิรภพ	\N	วิไลวรรณ	1	1	0	0	3	ถนนชัยพฤกษ์	\N	\N	9203	2558	421	3	3.31	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	8-8401-50080-92-2	\N	1	เอกพงษ์	\N	แสงสว่าง	1	1	0	0	5	ถนนกาญจนาภิเษก	\N	\N	9201	2557	422	2	3.44	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	5	10010009	4-5673-28864-10-7	\N	1	วสันต์	\N	แสงสว่าง	1	1	0	0	9	ถ.รัฐพัฒนา	\N	\N	9201	2558	421	3	3.88	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	8-1450-96762-95-9	\N	1	วรากร	\N	กิตติคุณ	1	1	0	0	2	ถ.บ้านโป่ง	\N	\N	9201	2560	112	3	2.86	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	1-5345-61062-99-6	\N	2	นันทพร	\N	วงษ์สุวรรณ	2	1	0	0	9	ถนนสีลม	\N	\N	9204	2566	102	1	2.72	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	2-4680-65302-62-3	\N	2	ทิพย์สุดา	\N	ทั่วถึง	2	1	0	0	3	ถนนชัยพฤกษ์	\N	\N	9201	2561	111	3	2.95	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	1	10010009	1-6955-13210-83-7	\N	1	ปิยังกูร	\N	เจริญชัย	1	1	0	0	4	ถนนเยาวราช	\N	\N	9201	2567	101	1	2.65	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	3-5260-68185-48-1	\N	2	กัญญา	\N	พันธุ์ดี	2	1	0	0	8	ถนนนิมมานเหมินท์	\N	\N	9201	2558	421	2	2.01	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	1	10010009	6-7170-66261-59-2	\N	1	พิพัฒน์	\N	ขาวสะอาด	1	1	0	0	10	ถนนสุดสาคร	\N	\N	9203	2556	423	3	3.94	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	6-1162-25012-96-8	\N	1	ศุภณัฐ	\N	อินทร์ชัย	1	1	0	0	7	ถนนบรมราชชนนี	\N	\N	9202	2563	105	3	3.87	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	1-8529-29665-58-8	\N	1	ทัศนัย	\N	ดีสมัย	1	1	0	0	1	ถนนช้างเผือก	\N	\N	9202	2558	421	2	2.68	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	1-1303-45466-53-9	\N	1	วรพล	\N	ศรีสุข	1	1	0	0	2	ถนนสุดสาคร	\N	\N	9202	2562	106	3	2.43	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	1-2434-83576-56-1	\N	2	ธัญชนก	\N	คงพิทักษ์	2	1	0	0	6	ถนนราษฎร์บูรณะ	\N	\N	9202	2561	111	2	2.43	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	8-4042-34348-45-2	\N	2	พรทิพย์	\N	วงษ์สุวรรณ	2	1	0	0	3	ถนนโชคชัย	\N	\N	9204	2567	103	2	3.76	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	2-6798-86150-87-3	\N	2	เกวลิน	\N	สุดสวย	2	1	0	0	3	ถนนศรีนครินทร์	\N	\N	9202	2557	422	2	2.25	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	7-8079-21236-54-3	\N	2	มาลัย	\N	สุดสวย	2	1	0	0	3	ถนนสรงประภา	\N	\N	9203	2560	112	2	2.05	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	4-3752-55675-53-2	\N	1	มานพ	\N	กิตติคุณ	1	1	0	0	5	ถนนสีลม	\N	\N	9204	2564	104	3	2.9	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	7-1993-55097-19-9	\N	1	วรากร	\N	ธนาคาร	1	1	0	0	3	ถนนรัตนาธิเบศร์	\N	\N	9201	2561	111	1	2.7	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	8-2818-36178-53-4	\N	1	นพรัตน์	\N	รุ่งเรือง	1	1	0	0	9	ถนนนิมมานเหมินท์	\N	\N	9201	2567	103	3	2.2	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	1	10010009	8-1969-39265-65-6	\N	2	กุลธิดา	\N	หอมหวาน	2	1	0	0	10	ถนนกลางเมือง	\N	\N	9202	2562	106	3	3.98	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	8-3574-88820-10-5	\N	1	ณัฐวุฒิ	\N	ลือชา	1	1	0	0	7	ถนนนวมินทร์	\N	\N	9201	2560	112	3	2.37	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	4-8866-16710-33-7	\N	1	วรากร	\N	สีดา	1	1	0	0	2	ถนนบายพาส	\N	\N	9204	2563	105	1	3.3	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	3-5791-20388-14-3	\N	3	กัญญาณัฐ	\N	สุดสวย	2	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	9204	2559	113	2	2.11	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	3-1306-85851-21-5	\N	1	ภูมิพัฒน์	\N	บุญรอด	1	1	0	0	4	ถนนรามคำแหง	\N	\N	9202	2557	422	3	2.41	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	4-2480-98777-18-9	\N	1	ปิยังกูร	\N	พรสวรรค์	1	1	0	0	10	ถนนราษฎร์บูรณะ	\N	\N	9203	2561	111	2	3.64	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	1	10010009	3-9863-78089-70-3	\N	1	ณัฐพล	\N	ลือชา	1	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	9202	2560	112	1	3.18	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	8-7539-76103-12-1	\N	2	ชลธิชา	\N	ทั่วถึง	2	1	0	0	1	ถ.เอกชัย	\N	\N	9201	2560	112	1	3.71	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	8-9681-58267-29-6	\N	3	เพ็ญพักตร์	\N	พันธุ์ดี	2	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	9202	2562	106	2	3.47	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	8-5278-42802-78-6	\N	1	คุณากร	\N	วิไลวรรณ	1	1	0	0	2	ถนนมิตรภาพ	\N	\N	9203	2559	113	1	2.25	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	3-7111-82929-93-9	\N	2	อภิญญา	\N	เพียรดี	2	1	0	0	6	ถนนช้างเผือก	\N	\N	9202	2566	102	2	2.88	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	1-9573-97084-67-5	\N	1	ธนภัทร	\N	พรประเสริฐ	1	1	0	0	9	ถนนห้วยแก้ว	\N	\N	9202	2556	423	2	2.19	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	1-8349-99189-27-6	\N	1	ศุภณัฐ	\N	ชัยมงคล	1	1	0	0	5	ถ.บ้านโป่ง	\N	\N	9204	2562	106	3	3.65	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	6-4110-26958-45-8	\N	3	ศิริพร	\N	พงษ์ไพร	2	1	0	0	9	ถนนบรมราชชนนี	\N	\N	9201	2562	106	2	3.07	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	8-5185-47350-63-4	\N	1	ธนภัทร	\N	มงคล	1	1	0	0	2	ถนนมาลัยแมน	\N	\N	9201	2562	106	1	2.23	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	1-9085-16181-90-5	\N	1	อนุชา	\N	สุวรรณภูมิ	1	1	0	0	5	ถนนช้างเผือก	\N	\N	9201	2559	113	2	3.23	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	3	10010009	4-1409-59859-98-7	\N	1	ไกรวุฒิ	\N	สุดสวย	1	1	0	0	2	ถนนพหลโยธิน	\N	\N	9204	2560	112	3	3.74	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	6-3644-45225-62-8	\N	1	สุรชัย	\N	อ่อนน้อม	1	1	0	0	2	ถนนสาทร	\N	\N	9203	2567	103	2	2.5	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	4	10010009	1-9667-72822-55-4	\N	1	วีรชัย	\N	วังขวา	1	1	0	0	6	ถนนนวมินทร์	\N	\N	9203	2557	422	1	3.38	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	6-2858-40896-34-4	\N	1	ดิศรณ์	\N	สีดา	1	1	0	0	2	ถนนมาลัยแมน	\N	\N	9203	2561	111	2	3.4	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	4-6746-56657-25-7	\N	2	อภิญญา	\N	บุญมี	2	1	0	0	10	ถ.บ้านโป่ง	\N	\N	9202	2556	423	2	2.83	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	5-4768-83747-73-2	\N	1	บุญยิ่ง	\N	กิตติคุณ	1	1	0	0	9	ถนนโชคชัย	\N	\N	9204	2559	113	1	3.52	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	6-7819-46943-55-6	\N	3	นันทพร	\N	มงคล	2	1	0	0	4	ถนนราษฎร์บูรณะ	\N	\N	9201	2556	423	3	3.25	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	6-5364-50136-10-7	\N	2	ณัฐนิชา	\N	นามมนตรี	2	1	0	0	7	ถนนเจริญกรุง	\N	\N	9204	2556	423	3	2.8	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	4-1089-92028-80-1	\N	3	นันทพร	\N	คงมั่น	2	1	0	0	2	ถนนเพชรเกษม	\N	\N	9202	2560	112	1	2.79	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	1-3693-14691-98-1	\N	2	ธัญชนก	\N	อ่อนน้อม	2	1	0	0	6	ถนนอุดรดุษฎี	\N	\N	9202	2563	105	3	3.45	10	ตรัง	เมืองตรัง	นาพละ
2569	1	5	10010009	7-1781-19990-79-7	\N	2	ลลิตา	\N	เพียรดี	2	1	0	0	2	ถนนเพชรเกษม	\N	\N	9202	2564	104	2	3.4	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	6-9863-14204-56-2	\N	1	ชูเกียรติ	\N	สีดา	1	1	0	0	9	ถนนนิมมานเหมินท์	\N	\N	9204	2556	423	1	3.38	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	4	10010009	4-2981-77186-77-5	\N	1	ศิวกร	\N	อ่อนน้อม	1	1	0	0	10	ถ.รัฐพัฒนา	\N	\N	9204	2567	103	1	2.84	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	7-4662-40167-64-7	\N	3	ชลธิชา	\N	อินทร์ชัย	2	1	0	0	1	ถนนศรีนครินทร์	\N	\N	9202	2558	421	3	2.63	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	3-2730-25439-81-3	\N	1	ชาตรี	\N	รักษ์ไทย	1	1	0	0	9	ถนนงามวงศ์วาน	\N	\N	9201	2561	111	3	3.23	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	1	10010009	2-1289-56088-92-9	\N	1	ภูมิพัฒน์	\N	ปัญญาดี	1	1	0	0	2	ถนนเยาวราช	\N	\N	9203	2557	422	1	2.31	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	4-1576-87430-42-8	\N	3	สมหญิง	\N	เพียรดี	2	1	0	0	10	ถ.ประชาสามัคคี	\N	\N	9201	2563	105	2	2.28	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	2	10010009	7-5486-52579-74-3	\N	3	วาสนา	\N	สีดา	2	1	0	0	10	ถนนห้วยแก้ว	\N	\N	9203	2561	111	2	3.62	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	1-1685-39193-10-5	\N	2	จิราพร	\N	มงคล	2	1	0	0	8	ถนนเพชรเกษม	\N	\N	9204	2561	111	1	2.6	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	2	10010009	3-6996-42433-92-1	\N	3	รุ่งอรุณ	\N	พรสวรรค์	2	1	0	0	2	ถนนสรงประภา	\N	\N	9202	2560	112	2	4	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	6-3198-16758-72-9	\N	1	มานพ	\N	พันธุ์ดี	1	1	0	0	2	ถนนนวมินทร์	\N	\N	9201	2559	113	1	2.18	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	4	10010009	7-4873-69058-15-8	\N	3	สุมาลี	\N	จันทร์แก้ว	2	1	0	0	1	ถนนเยาวราช	\N	\N	9203	2559	113	2	2.83	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	2	10010009	2-5181-40933-57-4	\N	1	วสันต์	\N	เพียรดี	1	1	0	0	6	ถนนมิตรภาพ	\N	\N	9204	2567	101	2	3.56	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	5	10010009	7-7340-14663-17-8	\N	2	อัมพร	\N	บุญมี	2	1	0	0	5	ถนนพหลโยธิน	\N	\N	9202	2562	106	3	2.6	10	ตรัง	เมืองตรัง	นาพละ
2569	1	1	10010009	2-7042-23268-48-2	\N	1	ชัยชนะ	\N	รักษ์ไทย	1	1	0	0	9	ถนนกลางเมือง	\N	\N	9204	2563	105	3	2.45	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	5-7334-83817-57-5	\N	2	วรรณภา	\N	ขาวสะอาด	2	1	0	0	5	ถนนห้วยแก้ว	\N	\N	9204	2567	103	2	2.21	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	3	10010009	2-3628-42232-47-1	\N	3	วันวิสา	\N	บริบูรณ์	2	1	0	0	1	ถนนบรมราชชนนี	\N	\N	9203	2567	101	2	3.87	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	3	10010009	6-1419-73271-65-3	\N	2	อรณิชา	\N	นิ่มนวล	2	1	0	0	10	ถนนกาญจนาภิเษก	\N	\N	9201	2560	112	1	3.26	10	ตรัง	เมืองตรัง	ทับเที่ยง
2569	1	1	10010009	3-1690-87607-48-4	\N	1	ภูมิพัฒน์	\N	จันทร์แก้ว	1	1	0	0	5	ถนนศรีนครินทร์	\N	\N	9202	2562	106	2	2.27	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	6-8589-69711-75-8	\N	1	ภูมิพัฒน์	\N	พรประเสริฐ	1	1	0	0	4	ถนนวิภาวดีรังสิต	\N	\N	9202	2556	423	1	3.35	10	ตรัง	เมืองตรัง	นาพละ
2569	1	4	10010009	8-4701-51337-73-2	\N	1	บุญยิ่ง	\N	วังขวา	1	1	0	0	4	ถนนบายพาส	\N	\N	9202	2564	104	1	2.57	10	ตรัง	เมืองตรัง	นาพละ
2569	1	3	10010009	6-4422-99487-56-3	\N	1	ธนพัฒน์	\N	มีสุข	1	1	0	0	6	ถนนนวมินทร์	\N	\N	9204	2558	421	3	2.99	10	ตรัง	เมืองตรัง	นาตาล่วง
2569	1	1	10010009	5-5065-65181-16-5	\N	3	นลินทิพย์	\N	วิไลวรรณ	2	1	0	0	4	ถนนประดิษฐ์มนูธรรม	\N	\N	9203	2561	111	2	2.69	10	ตรัง	เมืองตรัง	บ้านควน
2569	1	5	10010010	2-1236-19219-57-3	\N	3	ปาณิสรา	\N	มงคล	2	1	0	0	3	ถนนงามวงศ์วาน	\N	\N	3403	2560	112	1	2.5	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	3-4201-65789-81-9	\N	1	สมชาย	\N	งามดี	1	1	0	0	7	ถนนบายพาส	\N	\N	3405	2567	103	3	3.16	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	6-2656-19372-41-6	\N	1	ธนพัฒน์	\N	เพียรดี	1	1	0	0	3	ถนนศรีนครินทร์	\N	\N	3405	2561	111	1	2.47	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	2-8694-62707-79-2	\N	3	สุมาลี	\N	ดำรงค์	2	1	0	0	1	ถนนบรมราชชนนี	\N	\N	3403	2567	103	2	2.23	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	2-5792-20320-45-3	\N	1	ดิศรณ์	\N	นามมนตรี	1	1	0	0	4	ถ.ประชาสามัคคี	\N	\N	3404	2557	422	2	2.38	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	2-8235-40382-92-4	\N	3	ลลิตา	\N	วังขวา	2	1	0	0	1	ถนนงามวงศ์วาน	\N	\N	3403	2560	112	2	3.73	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	2-7087-83850-19-7	\N	3	เกวลิน	\N	สุขสันต์	2	1	0	0	7	ถนนมิตรภาพ	\N	\N	3405	2556	423	2	2.74	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	3-2254-38400-65-1	\N	2	สมหญิง	\N	ธนาคาร	2	1	0	0	2	ถ.เอกชัย	\N	\N	3404	2561	111	3	2.9	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	5-6417-36271-22-7	\N	1	พิพัฒน์	\N	ลือชา	1	1	0	0	6	ถนนบรมราชชนนี	\N	\N	3402	2558	421	3	2.25	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	6-5392-11373-13-9	\N	3	วิมลรัตน์	\N	ปัญญาดี	2	1	0	0	6	ถนนสีลม	\N	\N	3401	2561	111	3	2.23	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	8-7518-24026-99-1	\N	1	บุญยิ่ง	\N	เพียรดี	1	1	0	0	10	ถ.รัฐพัฒนา	\N	\N	3405	2561	111	1	2.23	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	1	10010010	1-9575-70196-76-2	\N	2	เกวลิน	\N	อินทร์ชัย	2	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	3401	2564	104	3	3.79	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	1	10010010	7-8735-16438-96-9	\N	2	ดวงใจ	\N	สกุลดี	2	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	3404	2561	111	2	3.79	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	5	10010010	6-3391-95818-76-6	\N	3	บุษยา	\N	ศรีสุข	2	1	0	0	8	ถนนนิมมานเหมินท์	\N	\N	3404	2563	105	1	2.05	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	1-7536-77396-84-9	\N	1	วรากร	\N	ชัยมงคล	1	1	0	0	6	ถนนบรมราชชนนี	\N	\N	3403	2558	421	3	2.74	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	8-9766-74215-35-5	\N	1	ปิยังกูร	\N	ศักดิ์สิทธิ์	1	1	0	0	9	ถนนรัตนาธิเบศร์	\N	\N	3401	2560	112	2	3.36	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	4	10010010	2-7236-84887-50-5	\N	3	สุภัสสรา	\N	นิ่มนวล	2	1	0	0	1	ถนนสรงประภา	\N	\N	3404	2563	105	2	2.75	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	4-7268-87045-89-6	\N	1	ชนะชัย	\N	ธนาคาร	1	1	0	0	8	ถนนเพชรเกษม	\N	\N	3402	2566	102	1	3.53	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	2-7921-81698-47-6	\N	1	วสันต์	\N	ยิ้มแย้ม	1	1	0	0	2	ถนนชัยพฤกษ์	\N	\N	3405	2563	105	2	2.04	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	8-9782-90499-96-4	\N	1	วรพล	\N	นามมนตรี	1	1	0	0	1	ถนนอ่อนนุช	\N	\N	3401	2558	421	1	3.04	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	4	10010010	7-4014-65377-28-3	\N	1	ศิวกร	\N	สีดา	1	1	0	0	3	ถนนมิตรภาพ	\N	\N	3404	2562	106	1	2.55	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	6-4265-33756-66-3	\N	3	กุลธิดา	\N	สกุลดี	2	1	0	0	8	ถนนสรงประภา	\N	\N	3402	2564	104	1	3.5	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	1-6960-85676-73-4	\N	1	ภัคพล	\N	ประสิทธิ์ผล	1	1	0	0	1	ถนนสุรวงศ์	\N	\N	3404	2567	101	2	3.82	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	4-1065-62516-81-3	\N	2	ชนิดา	\N	ลือชา	2	1	0	0	10	ถนนเยาวราช	\N	\N	3403	2562	106	3	3.8	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	3-5891-27776-67-2	\N	1	กวินท์	\N	แสงสว่าง	1	1	0	0	10	ถนนงามวงศ์วาน	\N	\N	3403	2560	112	3	2.84	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	8-3394-10201-31-9	\N	3	สิริมา	\N	สุดสวย	2	1	0	0	9	ถนนประดิษฐ์มนูธรรม	\N	\N	3405	2563	105	1	2.07	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	8-8800-15114-18-6	\N	1	นรวิชญ์	\N	ชูศรี	1	1	0	0	3	ถนนนิมมานเหมินท์	\N	\N	3404	2566	102	2	2.5	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	3-4557-28701-22-1	\N	1	กันตภณ	\N	พันธุ์ดี	1	1	0	0	4	ถนนสุดสาคร	\N	\N	3402	2561	111	1	3.86	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	6-5317-29268-73-1	\N	3	นวลจันทร์	\N	ปัญญาดี	2	1	0	0	10	ถนนโชคชัย	\N	\N	3401	2559	113	3	2.37	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	1	10010010	5-4081-13845-68-2	\N	1	ชนะชัย	\N	สุดสวย	1	1	0	0	5	ถนนนวมินทร์	\N	\N	3405	2567	103	3	2.31	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	3-9094-93485-55-9	\N	1	กิตติภณ	\N	ชัยมงคล	1	1	0	0	7	ถนนเจริญกรุง	\N	\N	3403	2562	106	1	3.58	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	5-7820-95915-66-5	\N	2	กัญญา	\N	คงพิทักษ์	2	1	0	0	9	ถนนชัยพฤกษ์	\N	\N	3404	2559	113	3	3.1	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	6-1136-49684-62-5	\N	1	ชินดนัย	\N	เพ็งพา	1	1	0	0	8	ถนนบรมราชชนนี	\N	\N	3405	2567	101	2	2.75	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	5-1875-63378-65-2	\N	2	วิมลรัตน์	\N	เจริญชัย	2	1	0	0	3	ถนนกาญจนาภิเษก	\N	\N	3403	2562	106	3	3.8	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	5-2879-82687-23-2	\N	2	ณัฐนิชา	\N	ใจดี	2	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	3404	2564	104	1	2.48	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	7-3670-63569-33-2	\N	2	จิราพร	\N	ทั่วถึง	2	1	0	0	7	ถนนประดิษฐ์มนูธรรม	\N	\N	3401	2562	106	3	3.88	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	2	10010010	2-6111-18881-14-3	\N	2	กาญจนา	\N	สีดา	2	1	0	0	5	ถนนเยาวราช	\N	\N	3401	2559	113	1	2.76	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	7-9701-61192-46-3	\N	1	ธนาธิป	\N	ชูศรี	1	1	0	0	10	ถนนสุดสาคร	\N	\N	3403	2558	421	1	3.33	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	3-9062-98466-36-2	\N	1	สมศักดิ์	\N	กิตติคุณ	1	1	0	0	9	ถนนประดิษฐ์มนูธรรม	\N	\N	3402	2556	423	2	3.81	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	4-8256-46916-46-6	\N	3	ปัณฑิตา	\N	แสงสว่าง	2	1	0	0	8	ถนนงามวงศ์วาน	\N	\N	3403	2561	111	2	2.46	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	2	10010010	2-5165-28951-21-2	\N	1	บุญยิ่ง	\N	สกุลดี	1	1	0	0	5	ถนนสุขุมวิท	\N	\N	3404	2559	113	2	3.4	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	1-9103-17511-34-9	\N	2	นวลจันทร์	\N	อินทร์ชัย	2	1	0	0	4	ถนนวิภาวดีรังสิต	\N	\N	3404	2562	106	2	3.2	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	1-7817-97482-48-3	\N	1	เจษฎา	\N	ศรีสุข	1	1	0	0	3	ถนนสรงประภา	\N	\N	3402	2567	103	1	2.74	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	4	10010010	1-1463-46722-74-6	\N	3	ดวงใจ	\N	พรสวรรค์	2	1	0	0	3	ถนนเยาวราช	\N	\N	3401	2564	104	3	3.79	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	7-4575-89104-71-2	\N	1	กันตภณ	\N	อินทร์ชัย	1	1	0	0	9	ถนนลาดพร้าว	\N	\N	3403	2558	421	2	2.62	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	8-6844-93448-84-8	\N	1	ปรเมศวร์	\N	สีดา	1	1	0	0	10	ถนนกาญจนาภิเษก	\N	\N	3401	2559	113	1	2.48	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	4	10010010	7-9127-59431-60-8	\N	3	ชนิดา	\N	บริบูรณ์	2	1	0	0	5	ถนนบรมราชชนนี	\N	\N	3403	2562	106	2	2.76	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	5-1198-37853-31-5	\N	1	พิพัฒน์	\N	สุดสวย	1	1	0	0	3	ถนนราษฎร์บูรณะ	\N	\N	3405	2558	421	2	3.83	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	5-5700-93190-27-2	\N	1	ภัคพล	\N	สุดสวย	1	1	0	0	5	ถนนสุดสาคร	\N	\N	3403	2560	112	1	3.4	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	1-1864-53824-74-2	\N	1	ธนภัทร	\N	มณีรัตน์	1	1	0	0	10	ถนนประดิษฐ์มนูธรรม	\N	\N	3403	2556	423	3	2.38	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	6-2402-80376-39-8	\N	1	ภัคพล	\N	เกียรติสกุล	1	1	0	0	7	ถนนมิตรภาพ	\N	\N	3401	2563	105	2	3.16	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	1	10010010	4-5186-21958-12-9	\N	1	ทักษิณ	\N	บริบูรณ์	1	1	0	0	1	ถ.บ้านโป่ง	\N	\N	3405	2566	102	1	2.98	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	6-2839-37457-65-5	\N	3	ปัณฑิตา	\N	แสงสว่าง	2	1	0	0	1	ถนนสรงประภา	\N	\N	3402	2567	103	2	3.83	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	1-4132-23058-28-2	\N	2	ธัญชนก	\N	สุดสวย	2	1	0	0	6	ถนนช้างเผือก	\N	\N	3401	2556	423	2	3.17	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	8-2822-66803-60-6	\N	3	ดรุณี	\N	ดำรงค์	2	1	0	0	6	ถนนสาทร	\N	\N	3402	2557	422	1	3.22	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	1-4352-27017-80-1	\N	2	ปัณฑิตา	\N	บุญรอด	2	1	0	0	4	ถนนชัยพฤกษ์	\N	\N	3401	2558	421	3	2.94	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	2-8696-85962-29-2	\N	2	กุลธิดา	\N	ประสิทธิ์ผล	2	1	0	0	7	ถนนช้างเผือก	\N	\N	3401	2563	105	2	3.95	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	1	10010010	5-7691-82487-73-3	\N	1	พิพัฒน์	\N	สุขสันต์	1	1	0	0	7	ถนนรามคำแหง	\N	\N	3405	2566	102	1	2.65	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	1	10010010	4-9930-43741-54-1	\N	1	วุฒิพงษ์	\N	พงษ์ไพร	1	1	0	0	4	ถนนกลางเมือง	\N	\N	3404	2561	111	1	2.42	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	3-2920-36595-19-3	\N	3	สมหญิง	\N	บริบูรณ์	2	1	0	0	5	ถนนอ่อนนุช	\N	\N	3402	2560	112	1	3.33	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	2	10010010	4-7179-33374-20-6	\N	3	จันทร์เพ็ญ	\N	เจริญชัย	2	1	0	0	4	ถนนกาญจนาภิเษก	\N	\N	3404	2561	111	3	2.4	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	3-1153-54985-80-5	\N	3	พิมพ์ชนก	\N	สุขสบาย	2	1	0	0	10	ถนนประดิษฐ์มนูธรรม	\N	\N	3401	2563	105	2	3.46	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	1-1456-72853-47-9	\N	3	ปาณิสรา	\N	เกียรติสกุล	2	1	0	0	2	ถนนอ่อนนุช	\N	\N	3402	2567	101	1	3.14	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	2	10010010	5-2032-68078-54-2	\N	1	ประพันธ์	\N	พงษ์ไพร	1	1	0	0	9	ถนนสุขุมวิท	\N	\N	3402	2557	422	2	3.82	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	4	10010010	6-6372-44198-75-4	\N	1	กวินท์	\N	เพียรดี	1	1	0	0	9	ถนนอุดรดุษฎี	\N	\N	3403	2556	423	2	3.07	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	6-1074-72821-36-1	\N	2	กัญญาณัฐ	\N	ดีสมัย	2	1	0	0	10	ถนนรัตนาธิเบศร์	\N	\N	3403	2560	112	2	3.22	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	4-7336-65847-61-8	\N	3	อรณิชา	\N	สุจริต	2	1	0	0	4	ถนนเพชรเกษม	\N	\N	3405	2564	104	2	3.96	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	4-4346-81410-83-8	\N	1	ทัศนัย	\N	คงพิทักษ์	1	1	0	0	6	ถนนนิมมานเหมินท์	\N	\N	3404	2559	113	3	3.04	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	6-4126-91002-39-5	\N	2	ณัฐนิชา	\N	เพียรดี	2	1	0	0	3	ถ.ประชาสามัคคี	\N	\N	3401	2567	101	1	2.93	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	6-7826-58228-89-7	\N	1	ธนพัฒน์	\N	ปัญญาดี	1	1	0	0	1	ถนนวิภาวดีรังสิต	\N	\N	3402	2558	421	3	2.24	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	1-7301-46776-79-2	\N	1	ธนาธิป	\N	ศักดิ์สิทธิ์	1	1	0	0	4	ถนนสุรวงศ์	\N	\N	3404	2567	103	2	3.03	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	5-3141-40381-51-1	\N	2	ศิริพร	\N	นิ่มนวล	2	1	0	0	7	ถนนนวมินทร์	\N	\N	3405	2557	422	2	3.73	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	3-7918-35733-79-3	\N	2	สิริมา	\N	ชูศรี	2	1	0	0	4	ถนนรามคำแหง	\N	\N	3402	2564	104	2	2.25	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	5-6814-43610-56-7	\N	1	มานพ	\N	พันธุ์ดี	1	1	0	0	1	ถนนอ่อนนุช	\N	\N	3404	2566	102	3	3.49	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	7-6907-86349-33-8	\N	1	ชัยชนะ	\N	ยิ้มแย้ม	1	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	3405	2563	105	3	3.79	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	5-9514-27033-68-8	\N	1	วสันต์	\N	สมบูรณ์	1	1	0	0	2	ถนนมิตรภาพ	\N	\N	3405	2564	104	2	2.78	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	4-7541-48993-49-8	\N	1	วสันต์	\N	ศรีสุข	1	1	0	0	8	ถนนราษฎร์บูรณะ	\N	\N	3405	2560	112	2	2.22	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	2-5190-68613-99-1	\N	1	รัฐนนท์	\N	บุญรอด	1	1	0	0	9	ถนนศรีนครินทร์	\N	\N	3405	2558	421	2	2.09	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	3-6781-77109-79-3	\N	1	ศุภณัฐ	\N	สุจริต	1	1	0	0	9	ถนนเยาวราช	\N	\N	3405	2561	111	1	3.05	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	6-2499-33036-79-6	\N	2	สุมาลี	\N	มีสุข	2	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	3401	2560	112	1	2.53	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	8-7131-65537-39-7	\N	1	วสันต์	\N	ปัญญาดี	1	1	0	0	6	ถนนรามคำแหง	\N	\N	3404	2559	113	3	3.82	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	3-4159-69395-25-3	\N	1	ชูเกียรติ	\N	ลือชา	1	1	0	0	6	ถนนสุขุมวิท	\N	\N	3401	2556	423	2	2.08	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	1	10010010	6-9427-25705-40-8	\N	2	วาสนา	\N	ศรีสุข	2	1	0	0	10	ถนนช้างเผือก	\N	\N	3402	2567	103	1	3.96	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	2	10010010	3-5335-14102-56-6	\N	1	ทักษิณ	\N	ธนาคาร	1	1	0	0	9	ถ.รัฐพัฒนา	\N	\N	3404	2564	104	3	2.68	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	5	10010010	6-6866-30520-31-3	\N	1	วิชญ์พล	\N	ปัญญาดี	1	1	0	0	10	ถ.ประชาสามัคคี	\N	\N	3403	2566	102	1	3.69	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	6-6150-47340-27-3	\N	2	ปัณฑิตา	\N	เกียรติสกุล	2	1	0	0	1	ถนนห้วยแก้ว	\N	\N	3405	2556	423	2	2.71	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	1	10010010	7-8338-41236-41-6	\N	3	สุมาลี	\N	สมบูรณ์	2	1	0	0	4	ถ.รัฐพัฒนา	\N	\N	3405	2564	104	1	3.28	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	2-8216-21208-87-6	\N	1	วสันต์	\N	สกุลดี	1	1	0	0	6	ถ.เอกชัย	\N	\N	3402	2567	101	1	2.58	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	3-2156-55604-98-7	\N	2	กุลธิดา	\N	คงพิทักษ์	2	1	0	0	8	ถนนกาญจนาภิเษก	\N	\N	3403	2556	423	2	3.71	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	4-7780-61533-41-9	\N	3	สิริมา	\N	พันธุ์ดี	2	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	3404	2559	113	1	3.29	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	6-9235-43796-12-6	\N	1	วีรชัย	\N	ยิ้มแย้ม	1	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	3405	2563	105	1	3.36	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	7-3017-68473-30-8	\N	3	เกวลิน	\N	สมบูรณ์	2	1	0	0	5	ถนนมาลัยแมน	\N	\N	3402	2563	105	3	3.28	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	3-9653-69109-13-4	\N	1	ธนภัทร	\N	พงษ์ไพร	1	1	0	0	6	ถนนบรมราชชนนี	\N	\N	3403	2566	102	1	3.64	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	1-8810-16518-64-5	\N	3	กัญญาณัฐ	\N	เพียรดี	2	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	3405	2560	112	2	2.68	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	7-2742-22709-51-6	\N	2	รุ่งอรุณ	\N	ยิ้มแย้ม	2	1	0	0	6	ถนนศรีนครินทร์	\N	\N	3402	2560	112	1	3.6	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	4	10010010	3-1881-24882-56-9	\N	2	สมหญิง	\N	ธนาคาร	2	1	0	0	2	ถนนรามคำแหง	\N	\N	3402	2560	112	3	3.62	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	2-8104-93575-89-6	\N	1	ภูมิพัฒน์	\N	วิริยะ	1	1	0	0	2	ถนนมิตรภาพ	\N	\N	3402	2566	102	2	2.79	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	1-7924-13821-97-8	\N	1	อภิวัฒน์	\N	งามดี	1	1	0	0	2	ถนนสาทร	\N	\N	3402	2558	421	2	3.58	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	1-7292-11306-64-1	\N	3	นภาพร	\N	พรสวรรค์	2	1	0	0	6	ถนนรัตนาธิเบศร์	\N	\N	3404	2564	104	3	3.77	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	5-1360-22747-94-5	\N	2	วิมลรัตน์	\N	สุวรรณภูมิ	2	1	0	0	5	ถนนลาดพร้าว	\N	\N	3401	2563	105	3	2.46	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	4-6263-39507-22-8	\N	2	เพ็ญพักตร์	\N	นามมนตรี	2	1	0	0	4	ถนนชัยพฤกษ์	\N	\N	3402	2558	421	3	3.78	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	2	10010010	2-2093-42526-43-2	\N	2	อัมพร	\N	สุวรรณภูมิ	2	1	0	0	5	ถนนประดิษฐ์มนูธรรม	\N	\N	3403	2567	103	1	2.72	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	7-7060-80717-99-4	\N	1	ปรเมศวร์	\N	รุ่งเรือง	1	1	0	0	6	ถนนศรีนครินทร์	\N	\N	3405	2566	102	1	3.81	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	7-1440-63643-88-5	\N	2	นลินทิพย์	\N	มงคล	2	1	0	0	6	ถนนสุดสาคร	\N	\N	3405	2556	423	3	3.09	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	1	10010010	7-6413-84081-23-3	\N	2	ลลิตา	\N	คงพิทักษ์	2	1	0	0	4	ถนนเยาวราช	\N	\N	3402	2557	422	3	2.75	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	5-6388-69581-74-5	\N	3	นวลจันทร์	\N	นิ่มนวล	2	1	0	0	5	ถนนรัตนาธิเบศร์	\N	\N	3402	2567	101	2	3.48	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	4	10010010	5-7327-53235-97-1	\N	1	ทัศนัย	\N	อินทร์ชัย	1	1	0	0	3	ถนนประดิษฐ์มนูธรรม	\N	\N	3401	2556	423	2	2.23	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	2	10010010	2-1517-76936-19-9	\N	2	พิมพ์ชนก	\N	ใจดี	2	1	0	0	10	ถนนนวมินทร์	\N	\N	3405	2562	106	2	2.82	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	2-1720-47340-68-1	\N	1	อนุชา	\N	อ่อนน้อม	1	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	3402	2562	106	3	2.11	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	2	10010010	7-8699-27547-21-2	\N	3	ดวงใจ	\N	หอมหวาน	2	1	0	0	10	ถนนช้างเผือก	\N	\N	3403	2560	112	3	2.27	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	3-7586-56347-77-3	\N	1	ศุภณัฐ	\N	สุขสบาย	1	1	0	0	2	ถนนมาลัยแมน	\N	\N	3405	2558	421	2	3.45	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	1-1002-10901-78-9	\N	2	มณีรัตน์	\N	ขาวสะอาด	2	1	0	0	9	ถนนเจริญกรุง	\N	\N	3404	2563	105	3	3.76	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	8-3712-30984-32-9	\N	3	นวลจันทร์	\N	ขาวสะอาด	2	1	0	0	6	ถนนห้วยแก้ว	\N	\N	3401	2564	104	1	3.02	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	2-1735-74520-35-3	\N	2	มาลัย	\N	วงษ์สุวรรณ	2	1	0	0	8	ถนนมาลัยแมน	\N	\N	3403	2562	106	1	2.71	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	8-8394-42383-21-2	\N	1	มานพ	\N	สุจริต	1	1	0	0	1	ถนนราษฎร์บูรณะ	\N	\N	3405	2562	106	1	2.9	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	6-9909-51115-24-6	\N	2	ดวงใจ	\N	ธนาคาร	2	1	0	0	2	ถนนวิภาวดีรังสิต	\N	\N	3404	2567	101	3	2.83	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	8-9548-80308-20-2	\N	2	ปัณฑิตา	\N	กิตติคุณ	2	1	0	0	9	ถนนโชคชัย	\N	\N	3403	2557	422	2	2.27	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	1-6311-97309-83-6	\N	1	ชนะชัย	\N	งามดี	1	1	0	0	6	ถนนนวมินทร์	\N	\N	3401	2567	101	2	3.78	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	2	10010010	8-7656-87754-62-8	\N	3	ปัณฑิตา	\N	รักษ์ไทย	2	1	0	0	4	ถนนสรงประภา	\N	\N	3403	2559	113	3	2.88	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	8-4517-74943-26-4	\N	3	อภิญญา	\N	เจริญชัย	2	1	0	0	9	ถนนสุขุมวิท	\N	\N	3401	2559	113	1	2.35	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	4	10010010	7-3947-89036-59-7	\N	2	พรรษา	\N	รักษ์ไทย	2	1	0	0	9	ถนนศรีนครินทร์	\N	\N	3401	2561	111	3	3.95	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	5-3787-62037-79-6	\N	3	พรทิพย์	\N	เพ็งพา	2	1	0	0	5	ถนนวิภาวดีรังสิต	\N	\N	3405	2557	422	1	3.31	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	4-3384-19216-89-2	\N	3	พิมพ์ชนก	\N	วิริยะ	2	1	0	0	4	ถนนอ่อนนุช	\N	\N	3405	2562	106	2	3.87	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	1	10010010	4-5909-79729-54-7	\N	1	กันตภณ	\N	ขาวสะอาด	1	1	0	0	5	ถนนมิตรภาพ	\N	\N	3402	2563	105	2	3.21	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	2	10010010	5-5770-22653-61-4	\N	1	ศิวกร	\N	ขาวสะอาด	1	1	0	0	2	ถนนอุดรดุษฎี	\N	\N	3404	2558	421	2	2.05	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	4-4587-67754-85-1	\N	3	ประภา	\N	สุขสันต์	2	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	3401	2557	422	1	2.11	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	4	10010010	6-9202-13427-98-9	\N	2	อรณิชา	\N	บุญมี	2	1	0	0	6	ถนนมาลัยแมน	\N	\N	3401	2560	112	3	2.79	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	1-9205-76440-74-1	\N	1	ทัศนัย	\N	บุญมี	1	1	0	0	8	ถนนชัยพฤกษ์	\N	\N	3405	2561	111	1	3.33	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	8-8568-29121-29-7	\N	2	นันทพร	\N	ลือชา	2	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	3403	2566	102	1	3.94	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	7-2016-21708-51-1	\N	2	ลลิตา	\N	นามมนตรี	2	1	0	0	1	ถนนเจริญกรุง	\N	\N	3405	2561	111	3	3.45	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	7-6736-18850-65-8	\N	3	กัญญา	\N	งามดี	2	1	0	0	10	ถนนราษฎร์บูรณะ	\N	\N	3403	2559	113	1	3.42	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	2-8915-26067-75-7	\N	1	อภิวัฒน์	\N	มีสุข	1	1	0	0	8	ถนนรัตนาธิเบศร์	\N	\N	3401	2566	102	2	2.71	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	2	10010010	7-5182-80946-93-6	\N	2	วาสนา	\N	มงคล	2	1	0	0	5	ถ.รัฐพัฒนา	\N	\N	3404	2567	103	1	4	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	7-4420-43247-80-2	\N	1	ปัณณทัต	\N	อินทร์ชัย	1	1	0	0	4	ถนนสุขุมวิท	\N	\N	3402	2566	102	3	2.64	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	4	10010010	7-2885-97582-52-4	\N	1	พิพัฒน์	\N	สุจริต	1	1	0	0	10	ถนนสุรวงศ์	\N	\N	3402	2564	104	1	3.96	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	3-5622-10433-45-7	\N	1	ชาตรี	\N	ศักดิ์สิทธิ์	1	1	0	0	7	ถนนบรมราชชนนี	\N	\N	3401	2562	106	2	3.39	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	1	10010010	2-7156-22001-77-4	\N	1	วรากร	\N	ทองดี	1	1	0	0	3	ถนนนวมินทร์	\N	\N	3404	2566	102	3	3.02	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	2-2175-83588-71-9	\N	2	ชนิดา	\N	สกุลดี	2	1	0	0	6	ถนนรัตนาธิเบศร์	\N	\N	3404	2566	102	2	3.03	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	6-2074-47343-31-7	\N	1	เจษฎา	\N	ขาวสะอาด	1	1	0	0	2	ถนนเจริญกรุง	\N	\N	3402	2567	101	3	2.61	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	3-2322-95519-90-4	\N	1	ปรเมศวร์	\N	ขาวสะอาด	1	1	0	0	4	ถนนนวมินทร์	\N	\N	3401	2559	113	3	2.32	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	1	10010010	8-6876-70433-39-8	\N	2	สิริมา	\N	ทองดี	2	1	0	0	8	ถนนกลางเมือง	\N	\N	3404	2563	105	1	3.3	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	5-7061-28074-14-8	\N	3	วันวิสา	\N	อ่อนน้อม	2	1	0	0	3	ถนนช้างเผือก	\N	\N	3401	2559	113	3	3.18	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	4	10010010	2-4167-41016-12-9	\N	2	วันวิสา	\N	ดีสมัย	2	1	0	0	5	ถนนห้วยแก้ว	\N	\N	3404	2563	105	2	3.17	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	5-3052-32160-75-6	\N	2	นันทพร	\N	ปัญญาดี	2	1	0	0	2	ถนนเยาวราช	\N	\N	3403	2567	101	2	3.94	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	2	10010010	6-9649-66515-23-4	\N	1	ปัณณทัต	\N	งามดี	1	1	0	0	4	ถนนอ่อนนุช	\N	\N	3404	2558	421	1	2.7	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	2-2276-26232-95-4	\N	1	ธนภัทร	\N	สุวรรณภูมิ	1	1	0	0	8	ถนนสรงประภา	\N	\N	3404	2567	103	3	3.82	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	1-9382-33646-25-4	\N	1	อนุชา	\N	สุขสันต์	1	1	0	0	6	ถนนศรีนครินทร์	\N	\N	3404	2561	111	3	3.44	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	1-9999-38316-94-1	\N	1	วรากร	\N	ปัญญาดี	1	1	0	0	9	ถ.เอกชัย	\N	\N	3401	2566	102	1	3.27	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	4-9458-95087-87-2	\N	1	วิชญ์พล	\N	คงมั่น	1	1	0	0	10	ถนนประดิษฐ์มนูธรรม	\N	\N	3401	2564	104	3	3.68	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	2	10010010	2-9939-25624-44-4	\N	2	ณัฐนิชา	\N	มณีรัตน์	2	1	0	0	4	ถนนห้วยแก้ว	\N	\N	3405	2557	422	3	3.13	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	8-8962-96375-85-7	\N	2	ธัญชนก	\N	เกียรติสกุล	2	1	0	0	9	ถนนลาดพร้าว	\N	\N	3405	2561	111	1	2.85	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	5-5479-30775-35-6	\N	3	สุนิสา	\N	ดำรงค์	2	1	0	0	10	ถนนเจริญกรุง	\N	\N	3401	2561	111	2	2.71	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	2	10010010	1-3379-85603-15-8	\N	3	อภิญญา	\N	มณีรัตน์	2	1	0	0	6	ถนนเยาวราช	\N	\N	3405	2557	422	3	3.55	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	2-5934-70769-59-9	\N	1	อภิวัฒน์	\N	ยิ้มแย้ม	1	1	0	0	10	ถนนประดิษฐ์มนูธรรม	\N	\N	3403	2560	112	3	3.1	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	7-6850-76780-58-7	\N	1	ธัชพล	\N	ดีสมัย	1	1	0	0	9	ถนนเพชรเกษม	\N	\N	3405	2563	105	2	3.79	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	5-6314-41676-63-8	\N	2	วรรณภา	\N	สุขสันต์	2	1	0	0	10	ถนนอ่อนนุช	\N	\N	3403	2557	422	2	3.78	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	1-9303-97758-19-2	\N	1	รชานนท์	\N	ดีสมัย	1	1	0	0	8	ถนนมิตรภาพ	\N	\N	3402	2559	113	2	3.36	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	6-9510-97480-44-1	\N	2	สุนิสา	\N	วังขวา	2	1	0	0	9	ถนนมิตรภาพ	\N	\N	3403	2567	103	3	2.96	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	1-3881-31856-94-4	\N	2	สุภัสสรา	\N	ลือชา	2	1	0	0	6	ถนนมาลัยแมน	\N	\N	3401	2563	105	1	2.19	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	6-1375-88060-95-5	\N	1	วีรชัย	\N	สุวรรณภูมิ	1	1	0	0	5	ถนนสาทร	\N	\N	3405	2560	112	2	2.35	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	7-2086-79878-23-8	\N	3	ณัฐนิชา	\N	บุญรอด	2	1	0	0	5	ถนนห้วยแก้ว	\N	\N	3405	2561	111	3	3.38	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	4-8104-88434-99-1	\N	3	วันวิสา	\N	มีสุข	2	1	0	0	1	ถนนโชคชัย	\N	\N	3404	2561	111	1	2.98	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	1-8621-71393-45-7	\N	2	พรทิพย์	\N	อินทร์ชัย	2	1	0	0	8	ถนนเยาวราช	\N	\N	3404	2559	113	3	3.4	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	5	10010010	1-6250-54297-53-1	\N	1	ชินดนัย	\N	ขาวสะอาด	1	1	0	0	2	ถนนอ่อนนุช	\N	\N	3401	2556	423	3	3.36	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	2	10010010	8-3196-99690-72-5	\N	1	ชินดนัย	\N	ปัญญาดี	1	1	0	0	10	ถนนอุดรดุษฎี	\N	\N	3403	2564	104	3	2.36	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	1-3380-61278-25-1	\N	1	ชนะชัย	\N	วิริยะ	1	1	0	0	2	ถนนช้างเผือก	\N	\N	3405	2557	422	1	3.49	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	6-8695-72094-75-9	\N	3	นันทพร	\N	คงมั่น	2	1	0	0	5	ถนนมาลัยแมน	\N	\N	3402	2567	103	1	2.28	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	2	10010010	2-2479-77957-63-7	\N	1	กิตติภณ	\N	เกียรติสกุล	1	1	0	0	9	ถนนศรีนครินทร์	\N	\N	3403	2567	101	1	3.62	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	2-5633-84085-66-8	\N	3	รัตนาภรณ์	\N	อินทร์ชัย	2	1	0	0	5	ถนนเพชรเกษม	\N	\N	3403	2557	422	1	3.56	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	2-4171-24417-85-5	\N	1	ธนพัฒน์	\N	สุดสวย	1	1	0	0	9	ถนนราษฎร์บูรณะ	\N	\N	3402	2567	101	1	3.47	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	5-8080-40541-57-8	\N	1	เจษฎา	\N	รุ่งเรือง	1	1	0	0	2	ถนนนวมินทร์	\N	\N	3402	2557	422	1	3.59	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	4	10010010	5-6453-70404-24-5	\N	2	สมหญิง	\N	วิไลวรรณ	2	1	0	0	8	ถนนศรีนครินทร์	\N	\N	3403	2556	423	1	3.68	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	1-8244-19713-26-4	\N	3	ปาณิสรา	\N	คงพิทักษ์	2	1	0	0	4	ถนนอุดรดุษฎี	\N	\N	3402	2557	422	3	3.3	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	3-4595-67532-41-8	\N	2	วาสนา	\N	สุจริต	2	1	0	0	8	ถนนสุขุมวิท	\N	\N	3402	2558	421	2	2.71	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	2-4548-61747-44-4	\N	2	แสงดาว	\N	หอมหวาน	2	1	0	0	3	ถนนสุรวงศ์	\N	\N	3403	2561	111	3	3.83	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	2	10010010	6-6558-44083-74-5	\N	2	ดรุณี	\N	ประสิทธิ์ผล	2	1	0	0	1	ถนนพหลโยธิน	\N	\N	3402	2559	113	3	2.92	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	6-8522-63399-10-2	\N	2	นันทพร	\N	พรสวรรค์	2	1	0	0	10	ถนนสุดสาคร	\N	\N	3401	2561	111	3	3.08	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	3-9084-80449-96-4	\N	3	รุ่งอรุณ	\N	สุจริต	2	1	0	0	7	ถนนลาดพร้าว	\N	\N	3404	2556	423	1	3.65	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	3-1268-75519-94-9	\N	2	มาลัย	\N	วังขวา	2	1	0	0	4	ถนนสุรวงศ์	\N	\N	3405	2557	422	3	3.36	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	4-2339-89894-52-3	\N	1	ธนภัทร	\N	จันทร์แก้ว	1	1	0	0	7	ถนนเยาวราช	\N	\N	3402	2557	422	1	2.56	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	4	10010010	3-3368-94463-52-1	\N	3	กาญจนา	\N	หอมหวาน	2	1	0	0	6	ถนนนิมมานเหมินท์	\N	\N	3403	2562	106	3	3.77	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	5-8850-47596-33-1	\N	3	พรรษา	\N	วิริยะ	2	1	0	0	1	ถนนสรงประภา	\N	\N	3405	2561	111	2	3.24	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	3-5657-35234-96-9	\N	1	วิชญ์พล	\N	ขาวสะอาด	1	1	0	0	9	ถนนรัตนาธิเบศร์	\N	\N	3402	2563	105	1	3.94	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	2	10010010	3-9772-82373-47-1	\N	1	ปัณณทัต	\N	สีดา	1	1	0	0	10	ถนนสุดสาคร	\N	\N	3404	2564	104	3	2.69	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	6-2787-33042-29-1	\N	3	ชนิดา	\N	อินทร์ชัย	2	1	0	0	8	ถนนสรงประภา	\N	\N	3405	2560	112	1	3.25	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	6-7295-10720-32-3	\N	1	ณัฐวุฒิ	\N	ธนาคาร	1	1	0	0	3	ถนนกาญจนาภิเษก	\N	\N	3405	2561	111	3	3.88	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	1	10010010	4-8601-80054-12-1	\N	2	นวลจันทร์	\N	อินทร์ชัย	2	1	0	0	7	ถนนนวมินทร์	\N	\N	3402	2558	421	1	3.56	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	6-6351-58001-15-8	\N	3	พิมพ์ชนก	\N	นามมนตรี	2	1	0	0	10	ถนนอ่อนนุช	\N	\N	3402	2560	112	1	3.12	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	3-3096-49295-44-2	\N	1	ชูเกียรติ	\N	งามดี	1	1	0	0	4	ถนนลาดพร้าว	\N	\N	3401	2559	113	3	3.42	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	1-5577-25885-84-4	\N	2	ภัทรวดี	\N	วิริยะ	2	1	0	0	7	ถนนเยาวราช	\N	\N	3403	2564	104	3	3.66	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	2-9343-27890-33-3	\N	1	ทัศนัย	\N	เจริญชัย	1	1	0	0	5	ถนนรามคำแหง	\N	\N	3403	2556	423	2	3.68	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	1-3083-42074-32-4	\N	1	บุญยิ่ง	\N	วังขวา	1	1	0	0	3	ถนนรามคำแหง	\N	\N	3402	2556	423	2	2.12	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	2-5638-34460-73-4	\N	1	สุทธิพงษ์	\N	ดำรงค์	1	1	0	0	6	ถนนลาดพร้าว	\N	\N	3402	2567	103	2	3.87	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	2-1858-21061-86-6	\N	1	ปรเมศวร์	\N	จันทร์แก้ว	1	1	0	0	4	ถนนชัยพฤกษ์	\N	\N	3403	2563	105	1	2.79	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	3-9850-21639-47-4	\N	1	ธนภัทร	\N	ชัยมงคล	1	1	0	0	6	ถนนรามคำแหง	\N	\N	3405	2562	106	3	3.28	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	2-8954-63289-40-1	\N	2	ดวงใจ	\N	นิ่มนวล	2	1	0	0	2	ถนนเพชรเกษม	\N	\N	3405	2559	113	3	3.58	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	1	10010010	1-2283-97513-47-2	\N	1	สมชาย	\N	นามมนตรี	1	1	0	0	1	ถนนนิมมานเหมินท์	\N	\N	3402	2556	423	2	3.38	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	1-1419-90760-80-4	\N	1	ภูมิพัฒน์	\N	รุ่งเรือง	1	1	0	0	3	ถ.บ้านโป่ง	\N	\N	3403	2561	111	2	3.91	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	2	10010010	4-8464-27145-57-3	\N	1	ภัคพล	\N	สง่างาม	1	1	0	0	1	ถนนห้วยแก้ว	\N	\N	3403	2556	423	3	3.38	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	7-8285-19402-28-8	\N	3	มณีรัตน์	\N	สุดสวย	2	1	0	0	10	ถนนนิมมานเหมินท์	\N	\N	3404	2567	101	3	2.64	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	8-3139-52097-35-4	\N	2	จันทร์เพ็ญ	\N	จันทร์แก้ว	2	1	0	0	3	ถนนนิมมานเหมินท์	\N	\N	3402	2563	105	2	3.95	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	8-8158-25182-83-3	\N	3	ปัณฑิตา	\N	เพียรดี	2	1	0	0	1	ถนนสรงประภา	\N	\N	3402	2560	112	2	3.11	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	3-7608-22101-64-7	\N	1	ปิยังกูร	\N	สุดสวย	1	1	0	0	9	ถนนเยาวราช	\N	\N	3403	2563	105	1	2.54	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	3-6610-80870-43-9	\N	2	แสงดาว	\N	จันทร์แก้ว	2	1	0	0	2	ถนนสุขุมวิท	\N	\N	3403	2562	106	3	3.3	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	2-5639-72097-14-6	\N	3	พิมพ์ชนก	\N	ชัยมงคล	2	1	0	0	7	ถนนนิมมานเหมินท์	\N	\N	3405	2563	105	1	3.41	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	7-9408-22481-50-4	\N	2	แสงดาว	\N	สุขสันต์	2	1	0	0	4	ถนนกาญจนาภิเษก	\N	\N	3404	2567	101	3	2.69	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	3-7840-88821-68-9	\N	2	พรทิพย์	\N	บุญรอด	2	1	0	0	9	ถนนอ่อนนุช	\N	\N	3403	2560	112	1	3.22	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	3-1709-94235-56-7	\N	1	รัฐนนท์	\N	แสงสว่าง	1	1	0	0	5	ถนนช้างเผือก	\N	\N	3402	2563	105	3	2.68	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	6-8161-56721-88-6	\N	1	ชินดนัย	\N	หอมหวาน	1	1	0	0	2	ถ.เอกชัย	\N	\N	3403	2560	112	2	3.07	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	5-5928-83832-27-1	\N	2	ดวงใจ	\N	สง่างาม	2	1	0	0	10	ถนนกลางเมือง	\N	\N	3405	2559	113	1	2.5	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	1	10010010	4-2185-22831-67-5	\N	3	ชนิดา	\N	นามมนตรี	2	1	0	0	10	ถนนวิภาวดีรังสิต	\N	\N	3405	2557	422	1	3.51	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	6-9207-70168-47-3	\N	2	อรณิชา	\N	สุขสันต์	2	1	0	0	8	ถนนมาลัยแมน	\N	\N	3405	2559	113	1	3.25	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	6-1380-84393-48-8	\N	1	ธนภัทร	\N	มงคล	1	1	0	0	9	ถนนบายพาส	\N	\N	3403	2558	421	2	3.65	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	2-1219-54095-82-3	\N	3	ชลธิชา	\N	ดีสมัย	2	1	0	0	6	ถนนเพชรเกษม	\N	\N	3405	2557	422	1	3.01	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	7-3608-42064-23-2	\N	1	ชนะชัย	\N	ศรีสุข	1	1	0	0	7	ถนนบายพาส	\N	\N	3405	2558	421	3	3.75	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	5-4167-36543-50-1	\N	3	ทิพย์สุดา	\N	อินทร์ชัย	2	1	0	0	2	ถนนมิตรภาพ	\N	\N	3404	2558	421	1	2.1	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	5-2503-44686-59-8	\N	2	วิมลรัตน์	\N	บริบูรณ์	2	1	0	0	4	ถนนช้างเผือก	\N	\N	3403	2563	105	3	2.81	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	6-8775-69928-43-2	\N	1	อนุชา	\N	วิริยะ	1	1	0	0	7	ถนนรามคำแหง	\N	\N	3402	2559	113	2	3.62	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	1-7511-37869-41-7	\N	3	ทิพย์สุดา	\N	สุจริต	2	1	0	0	6	ถนนช้างเผือก	\N	\N	3404	2563	105	2	2.8	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	7-8529-84815-59-4	\N	3	สุภัสสรา	\N	ศรีสุข	2	1	0	0	10	ถนนศรีนครินทร์	\N	\N	3401	2556	423	2	3.14	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	3-9245-51360-20-6	\N	3	มาลัย	\N	รักษ์ไทย	2	1	0	0	7	ถนนศรีนครินทร์	\N	\N	3402	2567	101	2	2.8	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	4	10010010	2-9187-38286-38-4	\N	1	วุฒิพงษ์	\N	คงพิทักษ์	1	1	0	0	7	ถนนรัตนาธิเบศร์	\N	\N	3403	2558	421	2	3.26	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	1-7024-38143-46-6	\N	1	ณัฐพล	\N	ลือชา	1	1	0	0	1	ถนนสาทร	\N	\N	3405	2557	422	2	2.77	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	1-7435-24299-75-5	\N	2	กัญญา	\N	สกุลดี	2	1	0	0	7	ถนนนิมมานเหมินท์	\N	\N	3403	2556	423	3	3.44	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	1-4337-59261-35-3	\N	2	นภาพร	\N	พรประเสริฐ	2	1	0	0	5	ถนนสรงประภา	\N	\N	3403	2563	105	2	2.61	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	3-2428-69870-38-7	\N	2	จิราพร	\N	รักษ์ไทย	2	1	0	0	7	ถนนช้างเผือก	\N	\N	3404	2563	105	3	3.94	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	1-9004-30809-73-8	\N	3	สุนิสา	\N	อินทร์ชัย	2	1	0	0	3	ถนนอ่อนนุช	\N	\N	3405	2567	103	2	3.84	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	7-6777-71549-90-2	\N	3	ทิพย์สุดา	\N	รุ่งเรือง	2	1	0	0	7	ถนนเยาวราช	\N	\N	3401	2566	102	2	3.55	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	1	10010010	3-4207-43475-84-5	\N	1	ดิศรณ์	\N	เพ็งพา	1	1	0	0	6	ถ.ประชาสามัคคี	\N	\N	3404	2561	111	3	3.39	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	5	10010010	5-9814-34099-64-2	\N	1	กันตภณ	\N	สุดสวย	1	1	0	0	5	ถนนเจริญกรุง	\N	\N	3403	2558	421	1	2.91	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	2-5001-36691-76-1	\N	1	ภูมิพัฒน์	\N	ชูศรี	1	1	0	0	8	ถนนพหลโยธิน	\N	\N	3405	2556	423	3	2.96	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	8-1155-54588-34-4	\N	1	วสันต์	\N	พงษ์ไพร	1	1	0	0	1	ถนนนวมินทร์	\N	\N	3401	2557	422	2	3.53	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	1	10010010	3-6039-90980-80-6	\N	2	กัญญาณัฐ	\N	บุญรอด	2	1	0	0	7	ถนนบรมราชชนนี	\N	\N	3404	2563	105	2	3.14	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	8-6873-79195-59-4	\N	1	กิตติภณ	\N	สุขสันต์	1	1	0	0	9	ถนนสุขุมวิท	\N	\N	3402	2558	421	3	3.66	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	7-2600-36372-10-7	\N	3	วรรณภา	\N	สง่างาม	2	1	0	0	4	ถนนห้วยแก้ว	\N	\N	3403	2563	105	2	2.15	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	1-5763-77493-12-9	\N	3	ปิยนุช	\N	ดีสมัย	2	1	0	0	9	ถนนพหลโยธิน	\N	\N	3405	2564	104	1	3.33	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	6-9682-43172-16-3	\N	3	นวลจันทร์	\N	หอมหวาน	2	1	0	0	5	ถนนสุรวงศ์	\N	\N	3405	2564	104	3	3.48	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	4-6543-97741-46-5	\N	2	ชลธิชา	\N	บุญรอด	2	1	0	0	5	ถนนช้างเผือก	\N	\N	3405	2558	421	1	2.92	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	2-6281-27331-60-2	\N	1	ชาตรี	\N	ทั่วถึง	1	1	0	0	5	ถนนมิตรภาพ	\N	\N	3404	2563	105	3	2.12	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	7-4740-66958-37-1	\N	2	สมหญิง	\N	สุขสันต์	2	1	0	0	6	ถนนรามคำแหง	\N	\N	3403	2567	101	3	3.46	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	2	10010010	7-4745-21699-68-4	\N	1	คุณากร	\N	วงษ์สุวรรณ	1	1	0	0	4	ถนนอ่อนนุช	\N	\N	3404	2556	423	2	3.23	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	1-2875-53155-96-1	\N	2	จิราพร	\N	ประสิทธิ์ผล	2	1	0	0	4	ถนนกาญจนาภิเษก	\N	\N	3405	2566	102	2	2.56	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	6-7637-34141-25-4	\N	1	รัฐนนท์	\N	มงคล	1	1	0	0	5	ถนนอ่อนนุช	\N	\N	3404	2556	423	3	2.35	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	6-8985-50644-88-3	\N	1	ประพันธ์	\N	มีสุข	1	1	0	0	2	ถนนสีลม	\N	\N	3401	2559	113	1	3.78	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	3-9374-68857-14-3	\N	3	พิมพ์ชนก	\N	วิริยะ	2	1	0	0	5	ถนนกลางเมือง	\N	\N	3402	2556	423	3	2.9	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	8-7525-93784-84-1	\N	3	สุดารัตน์	\N	งามดี	2	1	0	0	8	ถนนสุขุมวิท	\N	\N	3402	2566	102	3	3.76	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	4	10010010	7-8616-50110-43-4	\N	1	ชูเกียรติ	\N	สุจริต	1	1	0	0	6	ถนนสีลม	\N	\N	3405	2567	103	1	3.19	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	1	10010010	7-4386-42228-59-1	\N	3	ทิพย์สุดา	\N	ใจดี	2	1	0	0	7	ถนนบรมราชชนนี	\N	\N	3404	2562	106	2	3.76	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	2-3946-34895-12-4	\N	1	ทัศนัย	\N	สุดสวย	1	1	0	0	7	ถ.บ้านโป่ง	\N	\N	3401	2562	106	3	2.33	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	4	10010010	1-9888-21318-62-1	\N	1	ภัคพล	\N	วิริยะ	1	1	0	0	4	ถนนช้างเผือก	\N	\N	3403	2561	111	1	4	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	2	10010010	6-9638-11159-45-3	\N	1	นรวิชญ์	\N	สีดา	1	1	0	0	5	ถนนประดิษฐ์มนูธรรม	\N	\N	3403	2562	106	1	2.8	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	4-3621-19562-18-5	\N	2	ภัทรวดี	\N	เพียรดี	2	1	0	0	4	ถนนบายพาส	\N	\N	3404	2567	101	3	3.34	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	5-7335-59614-71-7	\N	3	กัญญา	\N	พรประเสริฐ	2	1	0	0	7	ถนนเจริญกรุง	\N	\N	3404	2561	111	1	3.95	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	8-1239-41465-74-8	\N	1	ทักษิณ	\N	คงมั่น	1	1	0	0	8	ถนนวิภาวดีรังสิต	\N	\N	3401	2557	422	3	2.98	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	1	10010010	3-7095-98129-67-1	\N	2	อภิญญา	\N	วิริยะ	2	1	0	0	5	ถนนกาญจนาภิเษก	\N	\N	3403	2557	422	3	3.04	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	2	10010010	8-5161-32538-22-1	\N	3	มณีรัตน์	\N	เพ็งพา	2	1	0	0	10	ถนนกาญจนาภิเษก	\N	\N	3405	2560	112	2	3.27	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	5-9370-87341-75-4	\N	1	ปิยังกูร	\N	ทองดี	1	1	0	0	1	ถนนรามคำแหง	\N	\N	3403	2558	421	3	3.57	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	4-6909-59259-67-7	\N	2	วรรณภา	\N	สง่างาม	2	1	0	0	1	ถนนสุขุมวิท	\N	\N	3404	2557	422	3	3.88	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	5	10010010	7-6497-48231-77-5	\N	3	ธัญชนก	\N	ทองดี	2	1	0	0	4	ถนนสาทร	\N	\N	3405	2561	111	1	3.28	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	2-7344-74934-74-1	\N	1	วรพล	\N	เกียรติสกุล	1	1	0	0	5	ถ.ประชาสามัคคี	\N	\N	3402	2560	112	1	2.5	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	3-7072-77458-33-5	\N	1	สมชาย	\N	ยิ้มแย้ม	1	1	0	0	10	ถนนเพชรเกษม	\N	\N	3403	2567	101	2	3.68	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	2-9301-85115-35-2	\N	2	บุษยา	\N	ศักดิ์สิทธิ์	2	1	0	0	1	ถนนมิตรภาพ	\N	\N	3404	2556	423	2	3.14	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	5-2356-60354-51-8	\N	3	นภาพร	\N	พรสวรรค์	2	1	0	0	2	ถนนเยาวราช	\N	\N	3405	2563	105	2	2.13	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	2-1490-52847-61-7	\N	1	บุญยิ่ง	\N	กิตติคุณ	1	1	0	0	4	ถนนสรงประภา	\N	\N	3405	2564	104	2	3.94	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	1	10010010	6-9075-81150-63-6	\N	3	ธัญชนก	\N	สกุลดี	2	1	0	0	4	ถนนช้างเผือก	\N	\N	3402	2567	103	1	3.89	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	4	10010010	1-4586-29032-22-2	\N	3	กัญญา	\N	รุ่งเรือง	2	1	0	0	3	ถนนกาญจนาภิเษก	\N	\N	3404	2559	113	1	2.85	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	5-5349-23276-79-6	\N	3	กัญญา	\N	วงษ์สุวรรณ	2	1	0	0	2	ถนนมาลัยแมน	\N	\N	3403	2556	423	2	3.22	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	1-9372-28847-38-8	\N	1	อนุชา	\N	เพ็งพา	1	1	0	0	2	ถนนสุขุมวิท	\N	\N	3404	2558	421	1	3.58	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	1-5529-68419-41-3	\N	3	มาลัย	\N	สุขสบาย	2	1	0	0	8	ถนนศรีนครินทร์	\N	\N	3402	2566	102	1	3.54	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	2-2681-65838-27-6	\N	1	กันตภณ	\N	ดีสมัย	1	1	0	0	10	ถนนบายพาส	\N	\N	3404	2564	104	3	3.54	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	8-8234-71041-25-7	\N	3	ชลธิชา	\N	ใจดี	2	1	0	0	4	ถนนรามคำแหง	\N	\N	3401	2567	101	3	3.86	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	8-9379-61698-24-2	\N	2	เพ็ญพักตร์	\N	พรประเสริฐ	2	1	0	0	9	ถนนงามวงศ์วาน	\N	\N	3401	2560	112	2	2.28	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	7-1744-97575-75-4	\N	1	นพรัตน์	\N	อินทร์ชัย	1	1	0	0	6	ถนนประดิษฐ์มนูธรรม	\N	\N	3403	2566	102	1	3.76	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	5-3607-10186-48-6	\N	2	วิมลรัตน์	\N	เกียรติสกุล	2	1	0	0	5	ถนนศรีนครินทร์	\N	\N	3403	2560	112	3	3.59	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	7-7701-83471-76-2	\N	3	นภาพร	\N	เพียรดี	2	1	0	0	5	ถนนช้างเผือก	\N	\N	3403	2557	422	2	2.63	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	4-4322-74018-36-4	\N	1	ทัศนัย	\N	ชูศรี	1	1	0	0	3	ถนนสุดสาคร	\N	\N	3402	2556	423	1	3.97	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	1-3389-13132-76-5	\N	2	วรรณภา	\N	คงพิทักษ์	2	1	0	0	3	ถ.รัฐพัฒนา	\N	\N	3403	2556	423	2	3.12	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	2-6171-72457-95-9	\N	1	สมชาย	\N	นิ่มนวล	1	1	0	0	7	ถนนเยาวราช	\N	\N	3405	2566	102	3	3.93	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	1	10010010	6-3428-98472-75-8	\N	2	จันทร์เพ็ญ	\N	ดำรงค์	2	1	0	0	1	ถนนลาดพร้าว	\N	\N	3404	2556	423	1	2.03	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	6-3493-18609-90-3	\N	1	สุทธิพงษ์	\N	แสงสว่าง	1	1	0	0	3	ถนนมิตรภาพ	\N	\N	3404	2558	421	2	2.85	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	3-1623-65553-63-6	\N	3	นันทพร	\N	พันธุ์ดี	2	1	0	0	5	ถนนกลางเมือง	\N	\N	3402	2559	113	2	3.6	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	1-8206-16160-18-1	\N	3	นวลจันทร์	\N	ธนาคาร	2	1	0	0	10	ถนนกลางเมือง	\N	\N	3404	2559	113	1	2.88	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	5	10010010	6-8423-82827-42-4	\N	3	กาญจนา	\N	อินทร์ชัย	2	1	0	0	8	ถนนบรมราชชนนี	\N	\N	3405	2560	112	3	2.26	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	7-2751-18202-70-9	\N	1	สุรชัย	\N	อ่อนน้อม	1	1	0	0	2	ถนนโชคชัย	\N	\N	3401	2567	101	2	3.78	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	7-3277-40913-87-4	\N	2	เกวลิน	\N	เกียรติสกุล	2	1	0	0	8	ถนนเจริญกรุง	\N	\N	3405	2561	111	1	3.15	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	7-3897-23913-11-1	\N	3	วรรณภา	\N	ใจดี	2	1	0	0	1	ถนนเยาวราช	\N	\N	3405	2563	105	2	2.16	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	6-8099-77621-53-1	\N	2	จันทร์เพ็ญ	\N	ธนาคาร	2	1	0	0	1	ถนนอ่อนนุช	\N	\N	3405	2562	106	1	2.87	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	1-3322-70278-91-5	\N	3	พิมพ์ชนก	\N	ใจดี	2	1	0	0	3	ถนนสาทร	\N	\N	3403	2558	421	1	3.18	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	2	10010010	5-8728-10541-21-3	\N	2	วาสนา	\N	มีสุข	2	1	0	0	7	ถนนสุขุมวิท	\N	\N	3404	2563	105	1	2.22	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	4-7352-27567-16-2	\N	2	สุนิสา	\N	นิ่มนวล	2	1	0	0	4	ถนนวิภาวดีรังสิต	\N	\N	3402	2561	111	2	3.26	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	4	10010010	3-9200-61640-26-9	\N	1	ชนะชัย	\N	หอมหวาน	1	1	0	0	2	ถนนบรมราชชนนี	\N	\N	3405	2566	102	2	2.84	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	6-4147-57804-85-2	\N	1	ชินดนัย	\N	ศรีสุข	1	1	0	0	4	ถนนมิตรภาพ	\N	\N	3405	2560	112	3	3.04	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	3-5866-53420-97-2	\N	1	ณัฐวรรธน์	\N	สกุลดี	1	1	0	0	10	ถนนเจริญกรุง	\N	\N	3402	2559	113	3	2.56	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	2	10010010	8-3434-35911-26-9	\N	2	บุษยา	\N	สีดา	2	1	0	0	9	ถนนราษฎร์บูรณะ	\N	\N	3402	2563	105	3	2.24	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	4-9681-71901-16-6	\N	1	ทักษิณ	\N	สมบูรณ์	1	1	0	0	6	ถนนวิภาวดีรังสิต	\N	\N	3404	2562	106	2	2.19	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	3-5832-24783-35-7	\N	3	ณัฐนิชา	\N	สุดสวย	2	1	0	0	10	ถนนลาดพร้าว	\N	\N	3403	2562	106	2	2.7	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	5-2722-11651-98-8	\N	2	ปัณฑิตา	\N	สีดา	2	1	0	0	2	ถ.เอกชัย	\N	\N	3403	2562	106	3	3.9	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	2	10010010	1-1008-46169-50-5	\N	3	วาสนา	\N	กิตติคุณ	2	1	0	0	6	ถ.บ้านโป่ง	\N	\N	3403	2564	104	3	2.89	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	3-7496-85431-54-4	\N	3	อรณิชา	\N	เกียรติสกุล	2	1	0	0	8	ถนนชัยพฤกษ์	\N	\N	3402	2561	111	1	3.02	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	7-6152-19583-47-4	\N	3	สุดารัตน์	\N	ดำรงค์	2	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	3404	2567	103	1	3.85	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	6-4862-50891-16-3	\N	1	ณัฐพล	\N	ชูศรี	1	1	0	0	10	ถ.บ้านโป่ง	\N	\N	3401	2557	422	2	3.44	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	2	10010010	8-1361-67053-94-5	\N	1	ธนพัฒน์	\N	ดำรงค์	1	1	0	0	1	ถนนงามวงศ์วาน	\N	\N	3403	2567	101	3	3.99	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	3-8019-39180-72-7	\N	1	วุฒิพงษ์	\N	นามมนตรี	1	1	0	0	10	ถนนสรงประภา	\N	\N	3405	2567	101	2	3.75	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	4-2829-81535-12-5	\N	2	จิราพร	\N	สุขสบาย	2	1	0	0	5	ถ.บ้านโป่ง	\N	\N	3403	2557	422	3	3.2	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	1-7703-17955-41-6	\N	3	ณัฐนิชา	\N	ทองดี	2	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	3403	2564	104	2	3.25	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	2-8953-23749-89-6	\N	3	พิมพ์ชนก	\N	ใจดี	2	1	0	0	4	ถ.ประชาสามัคคี	\N	\N	3401	2567	101	1	2.59	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	4	10010010	5-8756-85686-66-6	\N	1	นพรัตน์	\N	จันทร์แก้ว	1	1	0	0	4	ถนนงามวงศ์วาน	\N	\N	3404	2562	106	3	2.52	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	5-4515-41977-98-9	\N	1	ประพันธ์	\N	ทั่วถึง	1	1	0	0	3	ถนนเจริญกรุง	\N	\N	3403	2567	103	3	2.32	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	5-2721-82371-80-7	\N	1	วีรชัย	\N	มงคล	1	1	0	0	9	ถนนสรงประภา	\N	\N	3404	2561	111	1	3.27	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	5	10010010	8-4065-93084-97-4	\N	3	สุมาลี	\N	กิตติคุณ	2	1	0	0	1	ถ.ประชาสามัคคี	\N	\N	3401	2566	102	3	4	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	2-7218-51503-80-5	\N	3	ดวงใจ	\N	สุขสันต์	2	1	0	0	2	ถนนอ่อนนุช	\N	\N	3404	2566	102	2	3.74	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	7-5789-62669-32-1	\N	1	กิตติภณ	\N	สีดา	1	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	3405	2557	422	1	2.33	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	2-1474-33798-74-3	\N	2	ธัญชนก	\N	รุ่งเรือง	2	1	0	0	10	ถนนสุดสาคร	\N	\N	3401	2566	102	3	2.96	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	1	10010010	3-1893-40266-19-6	\N	1	วรพล	\N	งามดี	1	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	3405	2564	104	1	2.98	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	8-8581-32885-84-3	\N	1	เอกพงษ์	\N	สกุลดี	1	1	0	0	6	ถ.รัฐพัฒนา	\N	\N	3403	2567	101	1	3.55	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	1-6331-38860-29-6	\N	1	ภัคพล	\N	อินทร์ชัย	1	1	0	0	3	ถนนอุดรดุษฎี	\N	\N	3404	2566	102	1	2.69	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	5	10010010	3-5004-12172-71-4	\N	1	กิตติภณ	\N	ใจดี	1	1	0	0	9	ถนนเจริญกรุง	\N	\N	3401	2567	101	3	2.66	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	2	10010010	4-7804-55897-26-2	\N	1	วรากร	\N	ยิ้มแย้ม	1	1	0	0	1	ถนนงามวงศ์วาน	\N	\N	3402	2559	113	1	2.27	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	1-6701-16714-14-2	\N	1	กวินท์	\N	พรสวรรค์	1	1	0	0	2	ถ.รัฐพัฒนา	\N	\N	3403	2562	106	1	3.82	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	2-2035-52314-12-5	\N	1	ณัฐวุฒิ	\N	วิริยะ	1	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	3401	2567	103	2	3.33	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	1	10010010	3-9252-69718-52-1	\N	1	วรพล	\N	มงคล	1	1	0	0	9	ถนนศรีนครินทร์	\N	\N	3403	2558	421	1	2.23	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	1-8189-90802-85-2	\N	2	พรรษา	\N	ดีสมัย	2	1	0	0	5	ถนนสุรวงศ์	\N	\N	3405	2566	102	3	3.23	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	5-7249-80526-74-2	\N	2	ภัทรวดี	\N	ทองดี	2	1	0	0	8	ถนนห้วยแก้ว	\N	\N	3403	2567	101	1	2.95	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	5-9838-41381-53-2	\N	2	ชลธิชา	\N	ดำรงค์	2	1	0	0	3	ถ.รัฐพัฒนา	\N	\N	3403	2561	111	1	3.63	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	1-6799-34012-39-4	\N	3	พรทิพย์	\N	ทั่วถึง	2	1	0	0	5	ถ.เอกชัย	\N	\N	3402	2560	112	2	3.23	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	2	10010010	4-7179-45407-14-6	\N	2	พิมพ์ชนก	\N	ลือชา	2	1	0	0	9	ถนนช้างเผือก	\N	\N	3405	2562	106	2	3.46	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	8-1383-68000-67-6	\N	1	ชนะชัย	\N	บุญรอด	1	1	0	0	8	ถนนอุดรดุษฎี	\N	\N	3403	2567	101	2	3.21	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	5-3826-14325-41-1	\N	3	อรณิชา	\N	ใจดี	2	1	0	0	8	ถนนสาทร	\N	\N	3401	2562	106	1	3.89	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	8-9787-12773-11-8	\N	3	พรทิพย์	\N	พรประเสริฐ	2	1	0	0	9	ถนนบายพาส	\N	\N	3402	2556	423	1	2.64	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	5-8640-52895-50-1	\N	1	ภัคพล	\N	คงพิทักษ์	1	1	0	0	8	ถนนนิมมานเหมินท์	\N	\N	3401	2558	421	3	2.64	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	2	10010010	7-3754-62413-61-3	\N	1	สิรภพ	\N	ขาวสะอาด	1	1	0	0	7	ถนนสาทร	\N	\N	3403	2559	113	3	2.52	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	5-2301-51792-53-3	\N	2	ภัทรวดี	\N	วังขวา	2	1	0	0	10	ถนนราษฎร์บูรณะ	\N	\N	3402	2560	112	1	2.38	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	7-2923-61416-12-1	\N	3	พรรษา	\N	สุจริต	2	1	0	0	2	ถนนสาทร	\N	\N	3404	2567	103	1	2.87	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	5	10010010	8-8556-97285-77-3	\N	1	รัฐนนท์	\N	พงษ์ไพร	1	1	0	0	10	ถนนสุรวงศ์	\N	\N	3404	2563	105	2	2.13	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	5-1796-16790-87-1	\N	1	สุทธิพงษ์	\N	แสงสว่าง	1	1	0	0	7	ถนนศรีนครินทร์	\N	\N	3404	2564	104	1	3.67	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	1-7820-77751-82-1	\N	3	ณัฐนิชา	\N	รุ่งเรือง	2	1	0	0	3	ถนนกลางเมือง	\N	\N	3404	2566	102	1	3	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	5	10010010	5-1418-67924-94-1	\N	2	สุมาลี	\N	วิริยะ	2	1	0	0	5	ถนนรามคำแหง	\N	\N	3405	2559	113	2	2.4	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	2-9123-68692-27-4	\N	1	ธนาธิป	\N	นามมนตรี	1	1	0	0	8	ถ.ประชาสามัคคี	\N	\N	3401	2567	101	3	3.66	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	4-1918-25190-96-3	\N	1	กิตติภณ	\N	ดำรงค์	1	1	0	0	6	ถนนรามคำแหง	\N	\N	3401	2566	102	1	3.71	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	6-1749-32357-36-2	\N	3	วิมลรัตน์	\N	มณีรัตน์	2	1	0	0	4	ถ.ประชาสามัคคี	\N	\N	3403	2567	103	2	3.53	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	6-1848-38605-70-2	\N	3	จันทร์เพ็ญ	\N	สุขสันต์	2	1	0	0	6	ถนนสุขุมวิท	\N	\N	3404	2560	112	2	3.83	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	5	10010010	3-8146-80505-28-1	\N	1	สุรชัย	\N	หอมหวาน	1	1	0	0	2	ถนนชัยพฤกษ์	\N	\N	3405	2558	421	1	3.78	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	3-1786-73407-94-7	\N	1	อภิวัฒน์	\N	วังขวา	1	1	0	0	8	ถนนกลางเมือง	\N	\N	3401	2556	423	1	2.81	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	4	10010010	8-3305-58153-12-1	\N	3	ชนิดา	\N	จันทร์แก้ว	2	1	0	0	7	ถ.รัฐพัฒนา	\N	\N	3405	2556	423	3	3.57	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	5-3424-96358-36-2	\N	1	ภัคพล	\N	ชัยมงคล	1	1	0	0	6	ถนนเพชรเกษม	\N	\N	3405	2567	101	3	3.47	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	1	10010010	2-4737-53249-68-2	\N	1	ธนภัทร	\N	ยิ้มแย้ม	1	1	0	0	10	ถนนรัตนาธิเบศร์	\N	\N	3405	2559	113	2	3.03	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	7-6906-76466-74-2	\N	1	อนุชา	\N	สง่างาม	1	1	0	0	9	ถนนโชคชัย	\N	\N	3404	2564	104	3	2.4	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	8-2267-27334-55-6	\N	1	เจษฎา	\N	สุขสันต์	1	1	0	0	1	ถ.ประชาสามัคคี	\N	\N	3404	2557	422	2	2.14	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	5	10010010	8-9775-30914-63-5	\N	3	บุษยา	\N	ดำรงค์	2	1	0	0	1	ถนนประดิษฐ์มนูธรรม	\N	\N	3402	2567	103	1	3.65	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	3-9478-78411-52-6	\N	1	กันตภณ	\N	เพียรดี	1	1	0	0	10	ถนนบรมราชชนนี	\N	\N	3403	2562	106	1	2.55	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	7-7191-99393-41-6	\N	1	ธนพัฒน์	\N	บริบูรณ์	1	1	0	0	8	ถนนพหลโยธิน	\N	\N	3404	2560	112	2	2.63	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	5	10010010	4-3646-17995-11-8	\N	1	เอกพงษ์	\N	วิริยะ	1	1	0	0	4	ถนนประดิษฐ์มนูธรรม	\N	\N	3401	2567	103	2	3.57	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	1	10010010	7-3928-78817-87-8	\N	3	เกวลิน	\N	อินทร์ชัย	2	1	0	0	3	ถนนสรงประภา	\N	\N	3404	2567	101	1	2.68	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	5	10010010	8-8770-94358-97-7	\N	3	ดรุณี	\N	รุ่งเรือง	2	1	0	0	1	ถนนเพชรเกษม	\N	\N	3401	2562	106	3	2.44	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	6-4232-20398-25-6	\N	1	ชนะชัย	\N	มณีรัตน์	1	1	0	0	8	ถนนเพชรเกษม	\N	\N	3405	2562	106	2	2.26	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	2-1152-62750-77-5	\N	1	ชูเกียรติ	\N	เจริญชัย	1	1	0	0	7	ถนนอุดรดุษฎี	\N	\N	3403	2566	102	1	3.8	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	2-2018-38183-66-5	\N	3	มณีรัตน์	\N	เกียรติสกุล	2	1	0	0	10	ถ.ประชาสามัคคี	\N	\N	3405	2558	421	1	2.57	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	3-2289-31207-48-9	\N	1	ภัคพล	\N	ขาวสะอาด	1	1	0	0	8	ถนนอุดรดุษฎี	\N	\N	3403	2567	103	2	3.96	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	2	10010010	2-2360-42447-84-7	\N	3	ชลธิชา	\N	สุวรรณภูมิ	2	1	0	0	9	ถนนสุรวงศ์	\N	\N	3404	2567	101	1	3.52	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	8-3890-33423-12-8	\N	1	ดิศรณ์	\N	ธนาคาร	1	1	0	0	2	ถนนงามวงศ์วาน	\N	\N	3405	2567	101	3	3.18	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	5-5718-89268-28-8	\N	1	ประพันธ์	\N	มณีรัตน์	1	1	0	0	9	ถนนสาทร	\N	\N	3402	2563	105	2	2.83	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	4	10010010	5-6435-69185-24-6	\N	3	กาญจนา	\N	นามมนตรี	2	1	0	0	6	ถนนกาญจนาภิเษก	\N	\N	3403	2560	112	1	2.34	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	5-2131-32813-79-2	\N	3	บุษยา	\N	ลือชา	2	1	0	0	8	ถ.บ้านโป่ง	\N	\N	3402	2566	102	3	3.1	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	5-5451-50628-33-9	\N	1	วุฒิพงษ์	\N	วงษ์สุวรรณ	1	1	0	0	4	ถนนบายพาส	\N	\N	3404	2558	421	3	3.95	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	6-6279-45537-70-2	\N	1	ธนาธิป	\N	นามมนตรี	1	1	0	0	3	ถนนรัตนาธิเบศร์	\N	\N	3404	2558	421	1	2.62	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	1-7236-83486-33-5	\N	1	กวินท์	\N	อินทร์ชัย	1	1	0	0	3	ถนนสุรวงศ์	\N	\N	3401	2556	423	3	2.09	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	4-2656-82218-71-6	\N	3	สมหญิง	\N	ประสิทธิ์ผล	2	1	0	0	10	ถนนรัตนาธิเบศร์	\N	\N	3404	2559	113	1	2.25	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	7-5842-99474-24-2	\N	3	วาสนา	\N	ศรีสุข	2	1	0	0	9	ถนนเจริญกรุง	\N	\N	3405	2563	105	3	2.37	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	1-7924-24034-64-4	\N	1	วิชญ์พล	\N	สีดา	1	1	0	0	9	ถนนเยาวราช	\N	\N	3403	2558	421	2	2.09	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	2	10010010	8-3753-19239-81-6	\N	2	นลินทิพย์	\N	มณีรัตน์	2	1	0	0	1	ถนนประดิษฐ์มนูธรรม	\N	\N	3404	2557	422	2	3.7	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	6-5618-61084-46-9	\N	1	ปรเมศวร์	\N	ประสิทธิ์ผล	1	1	0	0	6	ถนนสุขุมวิท	\N	\N	3401	2563	105	1	2.61	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	1-2182-69545-56-6	\N	1	สุรชัย	\N	สุวรรณภูมิ	1	1	0	0	1	ถนนวิภาวดีรังสิต	\N	\N	3402	2556	423	1	3.4	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	8-8954-13132-19-6	\N	1	ณัฐวุฒิ	\N	มีสุข	1	1	0	0	4	ถนนอ่อนนุช	\N	\N	3405	2561	111	2	2.37	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	2-3524-41562-74-2	\N	2	จิตรลดา	\N	เพียรดี	2	1	0	0	2	ถนนประดิษฐ์มนูธรรม	\N	\N	3405	2562	106	3	2.34	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	7-3695-80332-90-5	\N	2	อภิญญา	\N	แสงสว่าง	2	1	0	0	4	ถนนราษฎร์บูรณะ	\N	\N	3404	2567	103	1	3.56	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	4-6234-59416-70-3	\N	1	บุญยิ่ง	\N	กิตติคุณ	1	1	0	0	10	ถนนกาญจนาภิเษก	\N	\N	3404	2557	422	3	3.26	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	7-5694-72765-29-9	\N	3	นันทพร	\N	ปัญญาดี	2	1	0	0	4	ถนนสุรวงศ์	\N	\N	3404	2563	105	1	2.31	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	4-3952-27844-29-8	\N	1	พิพัฒน์	\N	ทั่วถึง	1	1	0	0	6	ถนนบายพาส	\N	\N	3402	2560	112	3	2.76	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	5-2173-69818-38-1	\N	1	วุฒิพงษ์	\N	อ่อนน้อม	1	1	0	0	10	ถนนโชคชัย	\N	\N	3403	2561	111	1	2.75	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	3-5734-96445-28-5	\N	1	วรพล	\N	ธนาคาร	1	1	0	0	2	ถนนราษฎร์บูรณะ	\N	\N	3405	2557	422	3	3.49	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	4-3440-14082-89-4	\N	3	พรทิพย์	\N	พรสวรรค์	2	1	0	0	10	ถ.บ้านโป่ง	\N	\N	3405	2560	112	2	2.32	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	7-8253-67517-78-6	\N	2	เพ็ญพักตร์	\N	ปัญญาดี	2	1	0	0	2	ถนนกาญจนาภิเษก	\N	\N	3401	2567	103	1	3.3	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	5-3308-88703-92-8	\N	3	เกวลิน	\N	สง่างาม	2	1	0	0	4	ถ.บ้านโป่ง	\N	\N	3405	2567	103	2	2.69	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	5-9732-37944-35-8	\N	1	ภัคพล	\N	ศักดิ์สิทธิ์	1	1	0	0	6	ถนนกลางเมือง	\N	\N	3402	2562	106	1	2.41	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	4-2250-24038-59-6	\N	2	สมหญิง	\N	กิตติคุณ	2	1	0	0	4	ถนนรามคำแหง	\N	\N	3405	2561	111	1	2.62	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	7-8287-56136-66-1	\N	1	รชานนท์	\N	หอมหวาน	1	1	0	0	6	ถ.เอกชัย	\N	\N	3403	2567	103	3	3.54	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	4-4768-39688-39-6	\N	1	สุรชัย	\N	วงษ์สุวรรณ	1	1	0	0	7	ถนนราษฎร์บูรณะ	\N	\N	3403	2566	102	3	2.63	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	1-4977-44128-20-2	\N	2	เกวลิน	\N	ศรีสุข	2	1	0	0	4	ถ.ประชาสามัคคี	\N	\N	3402	2557	422	3	2.61	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	2	10010010	8-4743-80787-32-3	\N	1	บุญยิ่ง	\N	บุญมี	1	1	0	0	7	ถนนลาดพร้าว	\N	\N	3401	2564	104	1	2.26	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	4	10010010	8-1270-91873-89-7	\N	3	บุษยา	\N	ยิ้มแย้ม	2	1	0	0	5	ถนนนวมินทร์	\N	\N	3405	2557	422	2	2.46	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	6-2325-21326-12-3	\N	3	พรทิพย์	\N	วิไลวรรณ	2	1	0	0	10	ถนนเจริญกรุง	\N	\N	3404	2567	101	1	3.36	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	4-3398-68100-57-4	\N	2	มาลัย	\N	พรประเสริฐ	2	1	0	0	3	ถนนบายพาส	\N	\N	3402	2566	102	1	3.72	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	4-1214-61947-51-4	\N	3	วาสนา	\N	ดีสมัย	2	1	0	0	4	ถนนราษฎร์บูรณะ	\N	\N	3402	2561	111	3	3.87	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	7-7228-50515-97-2	\N	1	ไกรวุฒิ	\N	สุดสวย	1	1	0	0	2	ถนนช้างเผือก	\N	\N	3404	2557	422	1	3.65	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	3-4143-91504-63-6	\N	1	เอกพงษ์	\N	เจริญชัย	1	1	0	0	10	ถ.เอกชัย	\N	\N	3403	2564	104	2	3.63	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	5-8460-10407-35-3	\N	1	ภัคพล	\N	ชูศรี	1	1	0	0	3	ถนนมาลัยแมน	\N	\N	3401	2564	104	3	2.23	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	4-2324-36373-98-5	\N	1	เอกพงษ์	\N	สุขสบาย	1	1	0	0	10	ถ.รัฐพัฒนา	\N	\N	3405	2556	423	3	2.61	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	4-2652-31099-89-1	\N	1	รัฐนนท์	\N	ปัญญาดี	1	1	0	0	5	ถนนกาญจนาภิเษก	\N	\N	3401	2556	423	1	3.12	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	2	10010010	7-1544-21199-12-8	\N	1	ธนพัฒน์	\N	สุขสันต์	1	1	0	0	3	ถนนประดิษฐ์มนูธรรม	\N	\N	3402	2567	101	3	3.13	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	2-1642-22762-56-2	\N	1	สมศักดิ์	\N	บุญรอด	1	1	0	0	1	ถนนมาลัยแมน	\N	\N	3402	2564	104	1	3.72	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	1-5612-98355-91-3	\N	1	เอกพงษ์	\N	คงพิทักษ์	1	1	0	0	1	ถ.ประชาสามัคคี	\N	\N	3404	2562	106	2	3.13	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	1-6078-53787-35-2	\N	3	แสงดาว	\N	มงคล	2	1	0	0	10	ถนนกาญจนาภิเษก	\N	\N	3404	2567	101	1	3.96	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	3-8747-20418-43-8	\N	1	ปรเมศวร์	\N	คงมั่น	1	1	0	0	3	ถนนมิตรภาพ	\N	\N	3404	2561	111	3	3.66	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	8-7102-15181-84-5	\N	1	สุรชัย	\N	เจริญชัย	1	1	0	0	5	ถนนเยาวราช	\N	\N	3402	2558	421	1	3.64	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	1-2204-62197-20-7	\N	1	ศุภณัฐ	\N	กิตติคุณ	1	1	0	0	9	ถ.เอกชัย	\N	\N	3403	2564	104	1	3.99	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	6-8881-58782-79-5	\N	2	พรทิพย์	\N	กิตติคุณ	2	1	0	0	9	ถนนสุรวงศ์	\N	\N	3402	2566	102	1	2.73	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	2-1096-28821-82-6	\N	2	สิริมา	\N	มีสุข	2	1	0	0	8	ถนนประดิษฐ์มนูธรรม	\N	\N	3401	2558	421	1	3.58	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	2	10010010	6-9679-66278-27-4	\N	1	ธนาธิป	\N	สุจริต	1	1	0	0	5	ถนนชัยพฤกษ์	\N	\N	3402	2566	102	3	3.98	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	2	10010010	2-1272-25939-43-5	\N	1	วิชญ์พล	\N	ปัญญาดี	1	1	0	0	3	ถนนอ่อนนุช	\N	\N	3403	2562	106	1	2.84	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	1-7616-24159-90-3	\N	1	ประพันธ์	\N	เจริญชัย	1	1	0	0	6	ถนนรามคำแหง	\N	\N	3404	2567	103	2	3.01	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	4-9790-77103-82-4	\N	2	ปาณิสรา	\N	ขาวสะอาด	2	1	0	0	10	ถนนสุขุมวิท	\N	\N	3402	2559	113	1	3.08	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	7-9471-11363-29-7	\N	1	สมศักดิ์	\N	จันทร์แก้ว	1	1	0	0	9	ถ.เอกชัย	\N	\N	3404	2564	104	2	2.67	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	7-2876-29315-45-8	\N	3	วันวิสา	\N	ศรีสุข	2	1	0	0	7	ถนนประดิษฐ์มนูธรรม	\N	\N	3401	2563	105	2	3.33	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	7-7022-88385-96-1	\N	3	ดวงใจ	\N	เจริญชัย	2	1	0	0	3	ถนนประดิษฐ์มนูธรรม	\N	\N	3404	2564	104	2	3.21	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	5-9925-34022-52-5	\N	1	สุรชัย	\N	สุขสันต์	1	1	0	0	6	ถ.รัฐพัฒนา	\N	\N	3404	2563	105	2	3.23	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	5	10010010	2-4138-74273-94-7	\N	3	นลินทิพย์	\N	พันธุ์ดี	2	1	0	0	9	ถนนสุรวงศ์	\N	\N	3404	2557	422	1	2.08	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	1-5714-64989-56-4	\N	2	รัตนาภรณ์	\N	พงษ์ไพร	2	1	0	0	6	ถนนราษฎร์บูรณะ	\N	\N	3404	2566	102	3	2.9	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	8-8447-85017-80-4	\N	1	ชัยชนะ	\N	กิตติคุณ	1	1	0	0	1	ถนนรัตนาธิเบศร์	\N	\N	3401	2560	112	2	2.27	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	2	10010010	4-1798-73676-69-1	\N	1	วรพล	\N	ทั่วถึง	1	1	0	0	1	ถนนบรมราชชนนี	\N	\N	3401	2556	423	1	2.54	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	2	10010010	5-2021-84714-88-6	\N	1	ศุภณัฐ	\N	สุขสันต์	1	1	0	0	6	ถนนช้างเผือก	\N	\N	3403	2560	112	1	2.49	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	1-7295-36197-19-9	\N	1	ภัคพล	\N	สุขสันต์	1	1	0	0	6	ถนนวิภาวดีรังสิต	\N	\N	3402	2562	106	1	3.11	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	4	10010010	7-3296-93411-88-1	\N	2	วันวิสา	\N	สกุลดี	2	1	0	0	7	ถนนห้วยแก้ว	\N	\N	3404	2556	423	3	2.76	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	5-8806-35812-71-1	\N	1	ธัชพล	\N	สุวรรณภูมิ	1	1	0	0	5	ถนนราษฎร์บูรณะ	\N	\N	3401	2561	111	2	2.77	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	2	10010010	8-9660-74591-17-1	\N	1	พิพัฒน์	\N	ศรีสุข	1	1	0	0	1	ถนนเจริญกรุง	\N	\N	3403	2567	103	1	3.2	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	8-7528-41482-95-4	\N	3	อภิญญา	\N	แสงสว่าง	2	1	0	0	9	ถนนรามคำแหง	\N	\N	3404	2557	422	1	3.61	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	1-7435-30260-10-4	\N	1	ชินดนัย	\N	วิไลวรรณ	1	1	0	0	8	ถนนมาลัยแมน	\N	\N	3403	2556	423	3	2.43	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	8-4888-61852-63-9	\N	1	ปรเมศวร์	\N	ยิ้มแย้ม	1	1	0	0	1	ถนนสุรวงศ์	\N	\N	3401	2560	112	1	2.89	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	4	10010010	1-5400-60394-92-7	\N	1	ภัคพล	\N	สุขสันต์	1	1	0	0	1	ถนนลาดพร้าว	\N	\N	3405	2567	103	2	2.23	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	4-5484-45165-88-2	\N	2	เกวลิน	\N	ทั่วถึง	2	1	0	0	7	ถนนบรมราชชนนี	\N	\N	3401	2559	113	3	2.56	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	4	10010010	3-7824-95981-32-3	\N	2	เพ็ญพักตร์	\N	สมบูรณ์	2	1	0	0	6	ถนนช้างเผือก	\N	\N	3405	2560	112	3	3.4	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	1-9541-93051-88-1	\N	3	ลลิตา	\N	สง่างาม	2	1	0	0	7	ถนนบายพาส	\N	\N	3401	2559	113	2	3.44	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	2-7237-20244-63-4	\N	1	วิชญ์พล	\N	รุ่งเรือง	1	1	0	0	2	ถนนสุรวงศ์	\N	\N	3402	2559	113	1	3.16	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	3-9750-14070-44-4	\N	1	ปัณณทัต	\N	เจริญชัย	1	1	0	0	4	ถนนศรีนครินทร์	\N	\N	3402	2561	111	2	3.63	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	5-7812-22574-52-3	\N	3	ปาณิสรา	\N	นามมนตรี	2	1	0	0	9	ถนนมาลัยแมน	\N	\N	3403	2567	103	1	2.93	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	1-8974-87020-42-2	\N	1	ณัฐวุฒิ	\N	นิ่มนวล	1	1	0	0	8	ถนนสุขุมวิท	\N	\N	3401	2566	102	2	3.2	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	4	10010010	3-9699-31715-28-5	\N	2	ณัฐนิชา	\N	บุญมี	2	1	0	0	9	ถ.ประชาสามัคคี	\N	\N	3403	2559	113	1	2.79	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	7-6395-14314-12-1	\N	1	พิพัฒน์	\N	ลือชา	1	1	0	0	3	ถนนรามคำแหง	\N	\N	3401	2558	421	2	2.7	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	5-7711-96871-13-2	\N	3	เพ็ญพักตร์	\N	สง่างาม	2	1	0	0	7	ถนนช้างเผือก	\N	\N	3404	2564	104	3	3	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	6-2052-28443-57-2	\N	2	ชลธิชา	\N	ขาวสะอาด	2	1	0	0	7	ถนนสรงประภา	\N	\N	3404	2558	421	1	2.66	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	3	10010010	5-9177-47618-59-8	\N	1	ธนาธิป	\N	เจริญชัย	1	1	0	0	9	ถนนมิตรภาพ	\N	\N	3401	2560	112	1	3.84	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	1	10010010	1-5505-44940-58-4	\N	1	นรวิชญ์	\N	สกุลดี	1	1	0	0	6	ถนนประดิษฐ์มนูธรรม	\N	\N	3405	2567	103	3	2.69	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	8-2667-44946-25-2	\N	1	กิตติภณ	\N	ทั่วถึง	1	1	0	0	3	ถนนเพชรเกษม	\N	\N	3402	2564	104	1	3.3	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	5-2105-86478-35-7	\N	1	ทักษิณ	\N	ทองดี	1	1	0	0	3	ถนนบายพาส	\N	\N	3403	2567	103	3	3.88	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	1-8637-77126-18-9	\N	1	ศุภณัฐ	\N	สง่างาม	1	1	0	0	3	ถนนช้างเผือก	\N	\N	3402	2562	106	3	2.51	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	3-4575-25942-18-5	\N	1	ชนะชัย	\N	ชูศรี	1	1	0	0	3	ถนนสีลม	\N	\N	3402	2566	102	2	2.75	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	4	10010010	1-5220-91770-90-9	\N	1	ศุภณัฐ	\N	เกียรติสกุล	1	1	0	0	9	ถนนสีลม	\N	\N	3403	2560	112	3	3.38	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	4-6604-50626-41-3	\N	1	สมศักดิ์	\N	สมบูรณ์	1	1	0	0	9	ถนนกาญจนาภิเษก	\N	\N	3401	2564	104	3	2.26	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	5-4307-20052-10-8	\N	2	นวลจันทร์	\N	บุญมี	2	1	0	0	5	ถนนบรมราชชนนี	\N	\N	3405	2567	101	1	3.3	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	1-3733-16836-22-9	\N	3	ปิยนุช	\N	รุ่งเรือง	2	1	0	0	9	ถ.บ้านโป่ง	\N	\N	3403	2567	101	2	2.83	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	3-5450-17327-20-2	\N	1	ชูเกียรติ	\N	รุ่งเรือง	1	1	0	0	7	ถนนศรีนครินทร์	\N	\N	3405	2564	104	1	2.47	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	8-4963-32515-76-2	\N	1	ศุภณัฐ	\N	สง่างาม	1	1	0	0	10	ถ.รัฐพัฒนา	\N	\N	3404	2561	111	1	3.89	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	1-8059-64945-54-1	\N	2	สมหญิง	\N	บริบูรณ์	2	1	0	0	6	ถนนอุดรดุษฎี	\N	\N	3404	2559	113	1	3.01	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	8-2353-64007-18-8	\N	2	ทิพย์สุดา	\N	นามมนตรี	2	1	0	0	3	ถ.รัฐพัฒนา	\N	\N	3401	2567	103	1	2.98	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	4-2533-92236-90-7	\N	2	ชนิดา	\N	สุจริต	2	1	0	0	2	ถนนงามวงศ์วาน	\N	\N	3405	2556	423	2	2.52	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	1	10010010	3-4956-16756-13-5	\N	2	มาลัย	\N	นามมนตรี	2	1	0	0	5	ถนนชัยพฤกษ์	\N	\N	3402	2564	104	3	2.87	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	2-7679-63884-25-2	\N	1	มานพ	\N	นามมนตรี	1	1	0	0	9	ถนนกลางเมือง	\N	\N	3404	2567	101	3	3.2	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	5	10010010	8-4783-68079-80-7	\N	2	ปัณฑิตา	\N	วงษ์สุวรรณ	2	1	0	0	7	ถนนห้วยแก้ว	\N	\N	3401	2566	102	1	2.59	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	3	10010010	1-4127-44778-18-4	\N	3	รุ่งอรุณ	\N	ศรีสุข	2	1	0	0	9	ถนนมาลัยแมน	\N	\N	3405	2562	106	2	2.97	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	8-3790-55158-85-1	\N	3	ชลธิชา	\N	เจริญชัย	2	1	0	0	7	ถนนอ่อนนุช	\N	\N	3404	2559	113	3	2.95	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	1-1496-89394-86-2	\N	2	เพ็ญพักตร์	\N	ศรีสุข	2	1	0	0	3	ถนนเจริญกรุง	\N	\N	3402	2557	422	3	2.72	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	2-2588-10013-34-6	\N	1	วรพล	\N	ปัญญาดี	1	1	0	0	9	ถนนสุขุมวิท	\N	\N	3403	2566	102	2	2.64	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	5-6594-98112-84-4	\N	2	พรรษา	\N	แสงสว่าง	2	1	0	0	9	ถ.เอกชัย	\N	\N	3405	2567	103	1	2.3	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	3	10010010	5-7405-81675-24-7	\N	3	จิตรลดา	\N	อินทร์ชัย	2	1	0	0	7	ถนนศรีนครินทร์	\N	\N	3405	2564	104	2	2.65	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	1	10010010	4-7405-35775-69-6	\N	1	วรพล	\N	สุจริต	1	1	0	0	8	ถนนลาดพร้าว	\N	\N	3401	2560	112	1	3.73	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	1	10010010	8-9861-39667-37-7	\N	1	ชาตรี	\N	ใจดี	1	1	0	0	9	ถนนศรีนครินทร์	\N	\N	3405	2567	103	3	3.62	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	4	10010010	6-6970-68749-54-4	\N	3	ชลธิชา	\N	สุดสวย	2	1	0	0	2	ถนนรัตนาธิเบศร์	\N	\N	3403	2559	113	2	3.8	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	5-3992-72180-50-8	\N	1	ปรเมศวร์	\N	รุ่งเรือง	1	1	0	0	2	ถนนกาญจนาภิเษก	\N	\N	3404	2564	104	3	3.47	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	2	10010010	7-6654-36573-87-8	\N	1	ธนาธิป	\N	เกียรติสกุล	1	1	0	0	10	ถนนเยาวราช	\N	\N	3403	2557	422	3	2.2	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	3	10010010	7-9623-47034-83-3	\N	3	ลลิตา	\N	สุขสบาย	2	1	0	0	8	ถนนราษฎร์บูรณะ	\N	\N	3401	2556	423	3	3.29	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	3-5495-13828-27-4	\N	3	ปาณิสรา	\N	มงคล	2	1	0	0	1	ถนนเจริญกรุง	\N	\N	3402	2567	103	1	3.71	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	2-6127-14749-23-1	\N	1	ปรเมศวร์	\N	เพ็งพา	1	1	0	0	3	ถนนสุรวงศ์	\N	\N	3405	2566	102	1	3.42	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	5-1663-25932-66-8	\N	3	สุภัสสรา	\N	เพียรดี	2	1	0	0	5	ถนนเพชรเกษม	\N	\N	3402	2562	106	1	2.12	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	2-2832-10798-85-7	\N	1	ธนพัฒน์	\N	ดีสมัย	1	1	0	0	8	ถนนสุขุมวิท	\N	\N	3402	2558	421	3	2.74	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010010	4-5891-69931-92-9	\N	1	ศิวกร	\N	นิ่มนวล	1	1	0	0	8	ถ.รัฐพัฒนา	\N	\N	3401	2562	106	2	3.16	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	4	10010010	1-8566-29254-25-8	\N	3	นันทพร	\N	นามมนตรี	2	1	0	0	9	ถนนศรีนครินทร์	\N	\N	3404	2557	422	3	2.42	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	4	10010010	1-7625-77237-93-5	\N	1	ชัยชนะ	\N	ชูศรี	1	1	0	0	7	ถนนวิภาวดีรังสิต	\N	\N	3402	2562	106	3	3.57	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	7-4125-98593-56-9	\N	1	ปิยังกูร	\N	กิตติคุณ	1	1	0	0	8	ถนนอ่อนนุช	\N	\N	3402	2561	111	2	3.39	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	3	10010010	3-6136-83615-58-8	\N	1	ศุภณัฐ	\N	วงษ์สุวรรณ	1	1	0	0	5	ถนนห้วยแก้ว	\N	\N	3402	2562	106	2	3.46	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	2	10010010	2-7120-60620-19-4	\N	3	วิมลรัตน์	\N	อินทร์ชัย	2	1	0	0	7	ถนนโชคชัย	\N	\N	3401	2558	421	1	3.82	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	5-8054-10501-76-5	\N	1	วิชญ์พล	\N	พงษ์ไพร	1	1	0	0	7	ถ.ประชาสามัคคี	\N	\N	3402	2559	113	3	2.07	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	5	10010010	2-9417-72615-89-8	\N	3	ปัณฑิตา	\N	บุญมี	2	1	0	0	2	ถ.บ้านโป่ง	\N	\N	3403	2560	112	1	3.52	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	5	10010010	3-9031-69200-99-2	\N	1	ปิยังกูร	\N	พรสวรรค์	1	1	0	0	2	ถนนมิตรภาพ	\N	\N	3403	2567	101	1	2.98	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	4-7973-20855-40-3	\N	1	วุฒิพงษ์	\N	วิไลวรรณ	1	1	0	0	1	ถนนนิมมานเหมินท์	\N	\N	3401	2559	113	3	3.47	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	2	10010010	3-9296-22522-92-8	\N	1	ธัชพล	\N	สุขสันต์	1	1	0	0	10	ถนนบรมราชชนนี	\N	\N	3402	2567	103	1	2.55	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	4	10010010	7-2475-88590-61-8	\N	1	ศุภณัฐ	\N	คงมั่น	1	1	0	0	2	ถ.ประชาสามัคคี	\N	\N	3401	2564	104	1	3.98	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	4	10010010	8-2549-45499-18-7	\N	3	จิตรลดา	\N	พรประเสริฐ	2	1	0	0	9	ถนนศรีนครินทร์	\N	\N	3401	2567	103	1	2.92	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	1	10010010	3-2818-28094-67-2	\N	3	รุ่งอรุณ	\N	ชูศรี	2	1	0	0	3	ถนนบรมราชชนนี	\N	\N	3404	2563	105	1	2.89	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	5	10010010	8-4587-24320-64-8	\N	3	สุภัสสรา	\N	อ่อนน้อม	2	1	0	0	4	ถนนเยาวราช	\N	\N	3401	2567	103	2	3.56	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	2	10010010	7-2511-68655-74-5	\N	1	นพรัตน์	\N	สุขสันต์	1	1	0	0	1	ถนนห้วยแก้ว	\N	\N	3403	2564	104	2	3.08	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	2	10010010	3-7185-77158-70-4	\N	3	บุษยา	\N	อ่อนน้อม	2	1	0	0	8	ถนนพหลโยธิน	\N	\N	3401	2564	104	1	2.93	10	อุบลราชธานี	เมืองอุบลราชธานี	ในเมือง
2569	1	5	10010010	6-9623-94947-87-3	\N	1	กันตภณ	\N	นามมนตรี	1	1	0	0	8	ถนนประดิษฐ์มนูธรรม	\N	\N	3405	2558	421	2	2.97	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	5	10010010	2-9052-97217-84-4	\N	1	วรพล	\N	รักษ์ไทย	1	1	0	0	7	ถนนโชคชัย	\N	\N	3403	2561	111	3	2.62	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	1	10010010	3-7403-18723-10-2	\N	2	อภิญญา	\N	ศรีสุข	2	1	0	0	3	ถนนเจริญกรุง	\N	\N	3403	2557	422	1	3.82	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	4-4487-74343-64-8	\N	1	สุรชัย	\N	กิตติคุณ	1	1	0	0	4	ถนนราษฎร์บูรณะ	\N	\N	3403	2567	101	3	3.87	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	1-2425-44355-27-4	\N	3	ประภา	\N	เพ็งพา	2	1	0	0	6	ถนนสรงประภา	\N	\N	3404	2566	102	2	3.16	10	อุบลราชธานี	เมืองอุบลราชธานี	ปทุม
2569	1	1	10010010	7-3323-73604-61-7	\N	3	แสงดาว	\N	พงษ์ไพร	2	1	0	0	5	ถ.เอกชัย	\N	\N	3403	2567	101	2	2.61	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	2-4759-20436-12-7	\N	3	ปิยนุช	\N	มณีรัตน์	2	1	0	0	7	ถนนสุดสาคร	\N	\N	3403	2567	103	2	3.98	10	อุบลราชธานี	เมืองอุบลราชธานี	หนองขอน
2569	1	4	10010010	6-2927-36515-55-7	\N	1	วรพล	\N	รักษ์ไทย	1	1	0	0	1	ถนนรัตนาธิเบศร์	\N	\N	3405	2556	423	1	3.23	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	1	10010010	1-8030-92135-53-6	\N	1	บุญยิ่ง	\N	หอมหวาน	1	1	0	0	1	ถนนสาทร	\N	\N	3405	2562	106	2	3.11	10	อุบลราชธานี	เมืองอุบลราชธานี	ขามใหญ่
2569	1	2	10010010	6-5815-37467-29-3	\N	2	สิริมา	\N	สกุลดี	2	1	0	0	7	ถนนพหลโยธิน	\N	\N	3402	2567	101	2	2.98	10	อุบลราชธานี	เมืองอุบลราชธานี	หัวเรือ
2569	1	1	10010002	4-9737-88059-39-6	\N	1	ธนกฤต	\N	แสงสุวรรณ	1	1	0	0	5	ถนนวิภาวดีรังสิต	\N	\N	5005	2562	106	2	2.68	10	เชียงใหม่	เมืองเชียงใหม่	สุเทพ
2569	1	3	10010004	7-3835-98500-62-3	\N	1	ปวีณา	\N	วัฒนากุล	1	1	0	0	7	ถนนสุรวงศ์	\N	\N	1002	2567	101	2	3.19	10	กรุงเทพมหานคร	ดอนเมือง	ดอนเมือง
\.


--
-- Data for Name: system_settings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.system_settings (setting_key, setting_value, description, updated_at, created_at, created_by, updated_by) FROM stdin;
ABSENT_THRESHOLD_DAYS	3	จำนวนวันขาดเรียนติดต่อกันก่อนที่จะแจ้งเตือนหรือเปิดเคสอัตโนมัติ	2026-06-10 01:50:39.677841+00	2026-06-13 17:17:47.356254+00	\N	\N
ALERT_TRIGGER_TYPE	SCHEDULED	รูปแบบการทำงาน (SCHEDULED = ตามตารางกะเวลา, IMMEDIATE = แจ้งเตือนทันที)	2026-06-10 01:50:39.677841+00	2026-06-13 17:17:47.356254+00	\N	\N
ALERT_SCHEDULE_TIME	18:00	เวลาที่จะรันบอทตรวจสอบข้อมูล (HH:MM) เมื่อเลือกรูปแบบ SCHEDULED	2026-06-10 01:50:39.677841+00	2026-06-13 17:17:47.356254+00	\N	\N
\.


--
-- Data for Name: task_links; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.task_links (id, task_id, parent_link_id, token_hash, magic_link, delegation_depth, assigned_to_name, assigned_to_phone, assigned_to_email, otp_code, otp_expires_at, otp_verified, subject, status, admin_locked, admin_lock_reason, admin_lock_at, expires_at, created_at, created_by, login_role, login_permissions, login_data_scope, updated_at, updated_by) FROM stdin;
seed-link-1002	seed-task-1002	\N	bd74fe877fcc7a5bebc69199b356826063152f61eaea12e3ac3a30cd580a4958	/task/a459ade11b257556e0c71cc0fc3ab61a51d23c44d64df8d9f93097a0212214ae	0	ครูสุภาวดี ครูประจำชั้น	0800000008	seed.teacher.p3r1@example.test	\N	\N	0	ลงพื้นที่ติดตามนักเรียน	ACTIVE	0	\N	\N	2026-06-20 16:30:26.906096+00	2026-06-06 16:30:26.906096+00	5	\N	[]	{}	2026-06-06 16:30:26.906096+00	\N
seed-link-1003	seed-task-1003	\N	65531f33ee9c13a59caa3310f5100ce5233e0de8d4c33ac6ba65dd4702c05e64	/task/31619a47525b3cdf0a38add16ac369801ae14cb01ac7e5221f3587d3cc84ced1	0	ครูสุภาวดี ครูประจำชั้น	0800000008	seed.teacher.p3r1@example.test	\N	\N	0	สรุปผลช่วยเหลือนักเรียน	COMPLETED	0	\N	\N	2026-06-15 16:30:26.906096+00	2026-06-07 16:30:26.906096+00	5	\N	[]	{}	2026-06-07 16:30:26.906096+00	\N
seed-link-1004	seed-task-1004	\N	c60e7faff0a96ebc553a020f4d4585c2d7b76458832102948f34a4bc37714cfc	/task/945e8188915f93d35575bc97e99d9d4d10681ab582a3351ef700858e6001641a	0	ผอ.ปรียา ผู้อำนวยการ	0800000006	seed.director@example.test	\N	\N	0	ประเมินแนวทางช่วยเหลือ	ACTIVE	0	\N	\N	2026-06-17 16:30:26.906096+00	2026-06-08 16:30:26.906096+00	5	\N	[]	{}	2026-06-08 16:30:26.906096+00	\N
seed-link-attendance-1	seed-attendance-task-1	\N	28dff42dd38001a727e8b7e0e5e16c8976f428979d1c0d626d3e6160a5d95d82	/task/9bb1434e289021751e87823858a347fd175a85bbeda7ab9c2117797a4084d15b	0	ครูสุภาวดี ครูประจำชั้น	0800000008	seed.teacher.p3r1@example.test	\N	\N	0	เช็คชื่อ ป.3 ห้อง 1	ACTIVE	0	\N	\N	2026-06-13 16:30:26.906096+00	2026-06-09 16:30:26.906096+00	5	\N	[]	{}	2026-06-09 16:30:26.906096+00	\N
seed-link-attendance-2	seed-attendance-task-2	\N	d62a223deb3fc85828e558dee28ff2711d39499dc45e940a00b3699daa57091b	/task/9c637663cec8765ef41b961b7f34e4cb84b9779b79d023de601e7369d77f06cc	0	ครูชาญวิทย์ ครูประจำชั้น	0800000009	seed.teacher.p6r2@example.test	\N	\N	0	เช็คชื่อ ป.6 ห้อง 2	ACTIVE	1	ปิดลิงก์ชั่วคราว	2026-06-10 10:30:26.906096+00	2026-06-14 16:30:26.906096+00	2026-06-08 16:30:26.906096+00	5	\N	[]	{}	2026-06-08 16:30:26.906096+00	\N
seed-link-1005	seed-task-1005	\N	1491e917687e944a0cf35525131219dda75cc140f73c3f89a4bced1967669b87	/task/cd9c99fbe4d761679395deb7b47950ff358f72190a722c87115d87738ba6b0f9	0	ครูชาญวิทย์ ครูประจำชั้น	0800000009	seed.teacher.p6r2@example.test	\N	\N	0	ลงพื้นที่ติดตามนักเรียน	ACTIVE	0	\N	\N	2026-05-27 03:00:00+00	2026-05-20 03:00:00+00	5	\N	[]	{}	2026-05-20 03:00:00+00	\N
seed-link-attendance-3	seed-attendance-task-3	\N	97ebdfc85682e6c465f6aafdeacece83c7153c95b152e08bce811c0c7e69bd0f	/task/52851e14b4c4f7a569fe5056e08dc1fd34c6591d3b8496f8ee23fd53aaa948fe	0	ครูวีรพล ครูประจำชั้น	0800000010	seed.teacher.ud.p6r1@example.test	\N	\N	0	เช็คชื่อ ป.6 ห้อง 1	ACTIVE	0	\N	\N	2026-06-20 02:00:00+00	2026-06-13 02:00:00+00	14	\N	[]	{}	2026-06-13 02:00:00+00	\N
seed-link-login-1	seed-task-login-1	\N	620320ee74dcdb448c4c1df57674787a7b24d26d3d907a5cfb0ae6a6257b907b	/task/6e641b6f0595b5f2fb02b55fc9982ca5e9220e8c13fe54ffa658bc1bd36698bc	0	ครูสุภาวดี ครูประจำชั้น	\N	seed.teacher.p3r1@example.test	\N	\N	0	ลิงก์เข้าสู่ระบบสำหรับครู	ACTIVE	0	\N	\N	2026-06-19 04:00:00+00	2026-06-12 04:00:00+00	5	TEACHER	["home", "attendance", "students", "create"]	{"own_only": false, "school_ids": [10010002]}	2026-06-12 04:00:00+00	\N
seed-link-login-2	seed-task-login-2	\N	a49699205212c4615d9aa40b1f7044edb1793fe6ecdbed6241b9cd836a4132ba	/task/b78cd3a7b8de14078f446a822f3143619e3e639580403b9eef26f6410c932421	0	ผอ.ปรียา ผู้อำนวยการ	\N	seed.director@example.test	\N	\N	0	ลิงก์เข้าสู่ระบบสำหรับผู้บริหาร	ACTIVE	1	ปิดลิงก์โดยผู้ดูแลระบบ	2026-06-12 06:00:00+00	2026-06-19 05:00:00+00	2026-06-12 05:00:00+00	5	ADMIN_SCHOOL	["home", "attendance", "attendance-dashboard", "students"]	{"own_only": false, "school_ids": [10010002]}	2026-06-12 06:00:00+00	\N
\.


--
-- Data for Name: task_submissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.task_submissions (id, task_link_id, visit_lat, visit_lng, cause_category, cause_detail, photo_paths, recommendation, submitted_at, address_changed, updated_student_address, updated_lat, updated_lng, created_at, updated_at, created_by, updated_by) FROM stdin;
1	seed-link-1003	18.801	98.961	เศรษฐกิจครอบครัว	ผู้ปกครองมีรายได้ไม่แน่นอน นักเรียนขาดค่าเดินทาง	[]	ติดตามต่อเนื่องเดือนละครั้ง	2026-06-08 16:30:26.906096	f	\N	\N	\N	2026-06-13 17:17:47.356254+00	2026-06-13 17:17:47.356254+00	\N	\N
\.


--
-- Data for Name: tasks; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.tasks (id, case_id, status, max_delegation_depth, created_at, task_type, target_grade, target_room, target_school_id, updated_at, created_by, updated_by) FROM stdin;
seed-task-1002	1002	ACTIVE	3	2026-06-06 16:30:26.906096+00	VISIT	\N	\N	\N	2026-06-06 16:30:26.906096+00	\N	\N
seed-task-1003	1003	COMPLETED	3	2026-06-07 16:30:26.906096+00	VISIT	\N	\N	\N	2026-06-07 16:30:26.906096+00	\N	\N
seed-task-1004	1004	PENDING_REVIEW	3	2026-06-08 16:30:26.906096+00	VISIT	\N	\N	\N	2026-06-08 16:30:26.906096+00	\N	\N
seed-attendance-task-1	\N	ACTIVE	1	2026-06-09 16:30:26.906096+00	ATTENDANCE	ป.3	1	10010002	2026-06-09 16:30:26.906096+00	\N	\N
seed-attendance-task-2	\N	ACTIVE	1	2026-06-08 16:30:26.906096+00	ATTENDANCE	ป.6	2	10010002	2026-06-08 16:30:26.906096+00	\N	\N
seed-task-1005	1005	ACTIVE	3	2026-05-20 03:00:00+00	VISIT	\N	\N	\N	2026-05-20 03:00:00+00	5	5
seed-attendance-task-3	\N	ACTIVE	3	2026-06-13 02:00:00+00	ATTENDANCE	ป.6	1	10010002	2026-06-13 02:00:00+00	14	14
seed-task-login-1	\N	ACTIVE	3	2026-06-12 04:00:00+00	LOGIN	\N	\N	\N	2026-06-12 04:00:00+00	5	5
seed-task-login-2	\N	ACTIVE	3	2026-06-12 05:00:00+00	LOGIN	\N	\N	\N	2026-06-12 06:00:00+00	5	5
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, username, password, affiliation, status, created_at, "PersonID_Onec", phone, email, permissions, "FirstName", "LastName", role, data_scope, must_change_password, updated_at, created_by, updated_by) FROM stdin;
5	seed_admin	$2b$12$SQzXcd1Y7WARRtrBT7ijwOtQXcqSi6TrWHK4aMKuMtB7W057DRqoW	ส่วนกลาง	ACTIVE	2026-06-10 16:00:32.709641+00	seed-admin-001	0800000001	seed.admin@example.test	[]	อรทัย	บริหารกลาง	ADMIN	{}	t	2026-06-10 16:00:32.709641+00	\N	\N
6	seed_admin_province_cm	$2b$12$SQzXcd1Y7WARRtrBT7ijwOtQXcqSi6TrWHK4aMKuMtB7W057DRqoW	จังหวัดเชียงใหม่	ACTIVE	2026-06-10 16:00:32.709641+00	seed-admin-province-001	0800000002	seed.admin.province@example.test	[]	มณีรัตน์	ดูแลจังหวัด	ADMIN_PROVINCE	{"provinces": ["เชียงใหม่"]}	t	2026-06-10 16:00:32.709641+00	\N	\N
7	seed_admin_district_cm	$2b$12$SQzXcd1Y7WARRtrBT7ijwOtQXcqSi6TrWHK4aMKuMtB7W057DRqoW	อำเภอเมืองเชียงใหม่	ACTIVE	2026-06-10 16:00:32.709641+00	seed-admin-district-001	0800000003	seed.admin.district@example.test	[]	กิตติชัย	ดูแลอำเภอ	ADMIN_DISTRICT	{"districts": ["เมืองเชียงใหม่"], "provinces": ["เชียงใหม่"]}	t	2026-06-10 16:00:32.709641+00	\N	\N
8	seed_admin_subdistrict_suthep	$2b$12$SQzXcd1Y7WARRtrBT7ijwOtQXcqSi6TrWHK4aMKuMtB7W057DRqoW	ตำบลสุเทพ	ACTIVE	2026-06-10 16:00:32.709641+00	seed-admin-subdistrict-001	0800000004	seed.admin.subdistrict@example.test	[]	พัชรินทร์	ดูแลตำบล	ADMIN_SUBDISTRICT	{"districts": ["เมืองเชียงใหม่"], "provinces": ["เชียงใหม่"], "sub_districts": ["สุเทพ"]}	t	2026-06-10 16:00:32.709641+00	\N	\N
9	seed_admin_school_10010002	$2b$12$SQzXcd1Y7WARRtrBT7ijwOtQXcqSi6TrWHK4aMKuMtB7W057DRqoW	โรงเรียนบ้านหนองขาม	ACTIVE	2026-06-10 16:00:32.709641+00	seed-admin-school-001	0800000005	seed.admin.school@example.test	[]	วรพล	ดูแลโรงเรียน	ADMIN_SCHOOL	{"districts": ["เมืองเชียงใหม่"], "provinces": ["เชียงใหม่"], "school_ids": [10010002], "sub_districts": ["สุเทพ"]}	t	2026-06-10 16:00:32.709641+00	\N	\N
1	newnew	$2b$12$SQzXcd1Y7WARRtrBT7ijwOtQXcqSi6TrWHK4aMKuMtB7W057DRqoW	BUU	ACTIVE	2026-03-13 18:14:37.679195+00	1264646406406	0640649024	new@gmail.com	[]	ณัฐพล	สิทธิบุศย์​	ADMIN	{}	f	2026-03-13 18:14:37.679195+00	\N	\N
10	seed_director_10010002	$2b$12$SQzXcd1Y7WARRtrBT7ijwOtQXcqSi6TrWHK4aMKuMtB7W057DRqoW	โรงเรียนบ้านหนองขาม	ACTIVE	2026-06-10 16:00:32.709641+00	seed-director-001	0800000006	seed.director@example.test	[]	ปรียา	ผู้อำนวยการ	DIRECTOR	{"districts": ["เมืองเชียงใหม่"], "provinces": ["เชียงใหม่"], "school_ids": [10010002], "sub_districts": ["สุเทพ"]}	t	2026-06-10 16:00:32.709641+00	\N	\N
11	seed_executive	$2b$12$SQzXcd1Y7WARRtrBT7ijwOtQXcqSi6TrWHK4aMKuMtB7W057DRqoW	ผู้บริหารภาพรวม	ACTIVE	2026-06-10 16:00:32.709641+00	seed-executive-001	0800000007	seed.executive@example.test	[]	ธนากร	ผู้บริหาร	EXECUTIVE	{}	t	2026-06-10 16:00:32.709641+00	\N	\N
12	seed_teacher_cm_p3_1	$2b$12$SQzXcd1Y7WARRtrBT7ijwOtQXcqSi6TrWHK4aMKuMtB7W057DRqoW	โรงเรียนบ้านหนองขาม	ACTIVE	2026-06-10 16:00:32.709641+00	seed-teacher-001	0800000008	seed.teacher.p3r1@example.test	[]	สุภาวดี	ครูประจำชั้น	TEACHER	{"room_ids": [1], "districts": ["เมืองเชียงใหม่"], "provinces": ["เชียงใหม่"], "school_ids": [10010002], "grade_levels": [103], "sub_districts": ["สุเทพ"]}	t	2026-06-10 16:00:32.709641+00	\N	\N
13	seed_teacher_cm_p6_2	$2b$12$SQzXcd1Y7WARRtrBT7ijwOtQXcqSi6TrWHK4aMKuMtB7W057DRqoW	โรงเรียนบ้านหนองขาม	ACTIVE	2026-06-10 16:00:32.709641+00	seed-teacher-002	0800000009	seed.teacher.p6r2@example.test	[]	ชาญวิทย์	ครูประจำชั้น	TEACHER	{"room_ids": [2], "districts": ["เมืองเชียงใหม่"], "provinces": ["เชียงใหม่"], "school_ids": [10010002], "grade_levels": [106], "sub_districts": ["สุเทพ"]}	t	2026-06-10 16:00:32.709641+00	\N	\N
14	seed_teacher_ud_p6_1	$2b$12$SQzXcd1Y7WARRtrBT7ijwOtQXcqSi6TrWHK4aMKuMtB7W057DRqoW	โรงเรียนเตรียมอุดมภาคภูมิ	ACTIVE	2026-06-10 16:00:32.709641+00	seed-teacher-003	0800000010	seed.teacher.ud.p6r1@example.test	[]	ณรงค์ศักดิ์	ครูประจำชั้น	TEACHER	{"room_ids": [1], "districts": ["เมืองอุดรธานี"], "provinces": ["อุดรธานี"], "school_ids": [10010005], "grade_levels": [106], "sub_districts": ["บ้านขาว"]}	t	2026-06-10 16:00:32.709641+00	\N	\N
15	seed_student_cm_p3_1	$2b$12$SQzXcd1Y7WARRtrBT7ijwOtQXcqSi6TrWHK4aMKuMtB7W057DRqoW	โรงเรียนบ้านหนองขาม	ACTIVE	2026-06-10 16:00:32.709641+00	1-3066-30387-54-9	0800000011	seed.student@example.test	[]	นักเรียน	ทดสอบระบบ	STUDENT	{"own_only": true}	t	2026-06-10 16:00:32.709641+00	\N	\N
\.


--
-- Name: assistance_measures_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.assistance_measures_id_seq', 1, false);


--
-- Name: attendance_AttendanceID_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."attendance_AttendanceID_seq"', 32, true);


--
-- Name: cases_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.cases_id_seq', 1009, true);


--
-- Name: dropout_reasons_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.dropout_reasons_id_seq', 1, false);


--
-- Name: educational_areas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.educational_areas_id_seq', 1, false);


--
-- Name: external_users_ExternalID_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."external_users_ExternalID_seq"', 1, false);


--
-- Name: migrations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.migrations_id_seq', 5, true);


--
-- Name: related_agencies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.related_agencies_id_seq', 1, false);


--
-- Name: risk_factors_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.risk_factors_id_seq', 1, false);


--
-- Name: roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.roles_id_seq', 114, true);


--
-- Name: schedules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.schedules_id_seq', 1, false);


--
-- Name: task_submissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.task_submissions_id_seq', 1, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 15, true);


--
-- Name: migrations PK_8c82d7f526340ab734260ea46be; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.migrations
    ADD CONSTRAINT "PK_8c82d7f526340ab734260ea46be" PRIMARY KEY (id);


--
-- Name: assistance_measures assistance_measures_label_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assistance_measures
    ADD CONSTRAINT assistance_measures_label_key UNIQUE (label);


--
-- Name: assistance_measures assistance_measures_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assistance_measures
    ADD CONSTRAINT assistance_measures_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY ("AttendanceID");


--
-- Name: case_reviews case_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.case_reviews
    ADD CONSTRAINT case_reviews_pkey PRIMARY KEY (id);


--
-- Name: cases cases_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cases
    ADD CONSTRAINT cases_pkey PRIMARY KEY (id);


--
-- Name: dropout_reasons dropout_reasons_label_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dropout_reasons
    ADD CONSTRAINT dropout_reasons_label_key UNIQUE (label);


--
-- Name: dropout_reasons dropout_reasons_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dropout_reasons
    ADD CONSTRAINT dropout_reasons_pkey PRIMARY KEY (id);


--
-- Name: educational_areas educational_areas_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.educational_areas
    ADD CONSTRAINT educational_areas_name_key UNIQUE (name);


--
-- Name: educational_areas educational_areas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.educational_areas
    ADD CONSTRAINT educational_areas_pkey PRIMARY KEY (id);


--
-- Name: external_users external_users_PersonID_Onec_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.external_users
    ADD CONSTRAINT "external_users_PersonID_Onec_key" UNIQUE ("PersonID_Onec");


--
-- Name: external_users external_users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.external_users
    ADD CONSTRAINT external_users_pkey PRIMARY KEY ("ExternalID");


--
-- Name: grade_levels grade_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grade_levels
    ADD CONSTRAINT grade_levels_pkey PRIMARY KEY (id);


--
-- Name: related_agencies related_agencies_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.related_agencies
    ADD CONSTRAINT related_agencies_name_key UNIQUE (name);


--
-- Name: related_agencies related_agencies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.related_agencies
    ADD CONSTRAINT related_agencies_pkey PRIMARY KEY (id);


--
-- Name: risk_factors risk_factors_label_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.risk_factors
    ADD CONSTRAINT risk_factors_label_key UNIQUE (label);


--
-- Name: risk_factors risk_factors_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.risk_factors
    ADD CONSTRAINT risk_factors_pkey PRIMARY KEY (id);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);


--
-- Name: schools schools_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_pkey PRIMARY KEY (id);


--
-- Name: student_dropouts student_dropouts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_dropouts
    ADD CONSTRAINT student_dropouts_pkey PRIMARY KEY ("PersonID_Onec");


--
-- Name: student_term student_term_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_term
    ADD CONSTRAINT student_term_pkey PRIMARY KEY ("PersonID_Onec");


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (setting_key);


--
-- Name: task_links task_links_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_links
    ADD CONSTRAINT task_links_pkey PRIMARY KEY (id);


--
-- Name: task_links task_links_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_links
    ADD CONSTRAINT task_links_token_hash_key UNIQUE (token_hash);


--
-- Name: task_submissions task_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_submissions
    ADD CONSTRAINT task_submissions_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_attendance_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_date ON public.attendance USING btree ("AttendanceDate");


--
-- Name: idx_attendance_person_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_person_id ON public.attendance USING btree ("PersonID_Onec");


--
-- Name: idx_case_reviews_case_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_case_reviews_case_id ON public.case_reviews USING btree (case_id);


--
-- Name: idx_task_links_task_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_task_links_task_id ON public.task_links USING btree (task_id);


--
-- Name: idx_task_links_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_task_links_token ON public.task_links USING btree (token_hash);


--
-- Name: attendance trg_attendance_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_attendance_set_updated_at BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: case_reviews trg_case_reviews_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_case_reviews_set_updated_at BEFORE UPDATE ON public.case_reviews FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: cases trg_cases_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_cases_set_updated_at BEFORE UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: roles trg_roles_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_roles_set_updated_at BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: schools trg_schools_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_schools_set_updated_at BEFORE UPDATE ON public.schools FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: system_settings trg_system_settings_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_system_settings_set_updated_at BEFORE UPDATE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: task_links trg_task_links_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_task_links_set_updated_at BEFORE UPDATE ON public.task_links FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: task_submissions trg_task_submissions_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_task_submissions_set_updated_at BEFORE UPDATE ON public.task_submissions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tasks trg_tasks_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_tasks_set_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_users_set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: attendance attendance_PersonID_Onec_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT "attendance_PersonID_Onec_fkey" FOREIGN KEY ("PersonID_Onec") REFERENCES public.student_term("PersonID_Onec");


--
-- Name: attendance attendance_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: attendance attendance_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: case_reviews case_reviews_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.case_reviews
    ADD CONSTRAINT case_reviews_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;


--
-- Name: case_reviews case_reviews_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.case_reviews
    ADD CONSTRAINT case_reviews_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: case_reviews case_reviews_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.case_reviews
    ADD CONSTRAINT case_reviews_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cases cases_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cases
    ADD CONSTRAINT cases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cases cases_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cases
    ADD CONSTRAINT cases_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: student_dropouts fk_student_dropouts_school; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_dropouts
    ADD CONSTRAINT fk_student_dropouts_school FOREIGN KEY ("SchoolID_Onec") REFERENCES public.schools(id) ON DELETE SET NULL;


--
-- Name: student_term fk_student_term_school; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_term
    ADD CONSTRAINT fk_student_term_school FOREIGN KEY ("SchoolID_Onec") REFERENCES public.schools(id) ON DELETE SET NULL;


--
-- Name: users fk_users_role_name; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_users_role_name FOREIGN KEY (role) REFERENCES public.roles(name) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: roles roles_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: roles roles_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: schools schools_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: schools schools_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: system_settings system_settings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: system_settings system_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: task_links task_links_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_links
    ADD CONSTRAINT task_links_created_by_user_id_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: task_links task_links_parent_link_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_links
    ADD CONSTRAINT task_links_parent_link_id_fkey FOREIGN KEY (parent_link_id) REFERENCES public.task_links(id);


--
-- Name: task_links task_links_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_links
    ADD CONSTRAINT task_links_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_links task_links_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_links
    ADD CONSTRAINT task_links_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: task_submissions task_submissions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_submissions
    ADD CONSTRAINT task_submissions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: task_submissions task_submissions_task_link_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_submissions
    ADD CONSTRAINT task_submissions_task_link_id_fkey FOREIGN KEY (task_link_id) REFERENCES public.task_links(id);


--
-- Name: task_submissions task_submissions_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_submissions
    ADD CONSTRAINT task_submissions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: users users_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: users users_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;


--
-- PostgreSQL database dump complete
--

\unrestrict bc6hK9il0kuIl8TAiLWOzYOpQYQlzCVQdWE1LhdOILBXPcSFhqWccAhxPhMPKC2

