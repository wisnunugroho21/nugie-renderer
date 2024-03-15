#include "skybox.hpp"

namespace NugieApp {
	std::vector<glm::vec4> SkyBox::getSkyBoxVertices() {
		std::vector<glm::vec4> skyboxVertices;

		skyboxVertices.emplace_back(glm::vec4{ -1.0f, -1.0f,  1.0f, 1.0f }); //        7--------6
		skyboxVertices.emplace_back(glm::vec4{ 1.0f, -1.0f,  1.0f, 1.0f }); //       /|       /|
		skyboxVertices.emplace_back(glm::vec4{ 1.0f, -1.0f, -1.0f, 1.0f });//      	4--------5 |
		skyboxVertices.emplace_back(glm::vec4{ -1.0f, -1.0f, -1.0f, 1.0f });//      | |      | |
		skyboxVertices.emplace_back(glm::vec4{ -1.0f,  1.0f,  1.0f, 1.0f });//      | 3------|-2
		skyboxVertices.emplace_back(glm::vec4{ 1.0f,  1.0f,  1.0f, 1.0f });//      	|/       |/
		skyboxVertices.emplace_back(glm::vec4{ 1.0f,  1.0f, -1.0f, 1.0f });//      	0--------1
		skyboxVertices.emplace_back(glm::vec4{ -1.0f,  1.0f, -1.0f, 1.0f });

		return skyboxVertices;
	}

	std::vector<uint32_t> SkyBox::getSkyBoxIndices() {
		std::vector<uint32_t> skyBoxIndices {
			// Right
			1, 2, 6,
			6, 5, 1,

			// Left
			0, 4, 7,
			7, 3, 0,

			// Top
			4, 5, 6,
			6, 7, 4,

			// Bottom
			0, 3, 2,
			2, 1, 0,

			// Back
			0, 1, 5,
			5, 4, 0,

			// Front
			3, 7, 6,
			6, 2, 3
		};

		return skyBoxIndices;
	}
}