MOCKUP ?= frontend/mockup/urgence.html

.PHONY: build test e2e preview run caller docker clean

build:            ## embed the controller into the UI mockup -> frontend/dist/
	ORANGE_MOCKUP=$(MOCKUP) node frontend/build.mjs

test:             ## unit tests: controller (Node) + gateway + caller service (unittest)
	node tests/frontend/test_controller.mjs
	python3 -m unittest discover -s tests/backend -p 'test_*.py'
	python3 -m unittest discover -s tests/caller -p 'test_*.py'

e2e:              ## headless browser harness with fake models and two fake caller sites (needs Playwright + Chromium)
	python3 tests/e2e/verify_local.py

preview: build    ## UI review with fake models and fake caller sites on 127.0.0.1:8093 (user demo)
	python3 tools/preview_local.py --password-file .preview-password

run:              ## the gateway with real model services (127.0.0.1:8092)
	python3 backend/server.py

caller:           ## a caller site service with the models next to it (0.0.0.0:8094; see caller/env.example)
	python3 caller/service.py

docker:           ## build the three images
	docker compose --profile caller --profile preview build

clean:
	rm -rf frontend/dist tests/e2e/receipts
