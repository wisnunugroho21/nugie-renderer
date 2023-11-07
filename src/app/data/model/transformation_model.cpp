#include "transformation_model.hpp"

#include <cstring>
#include <iostream>
#include <unordered_map>

#define GLM_ENABLE_EXPERIMENTAL
#include <glm/gtx/hash.hpp>

namespace NugieApp {
	TransformationModel::TransformationModel(NugieVulkan::Device* device) : device{device} {
		this->createBuffers();
	}

	std::vector<Transformation> TransformationModel::convertToMatrix(std::vector<TransformComponent> transformations) {
		auto newTransforms = std::vector<Transformation>();
		for (auto &&transform : transformations) {
			newTransforms.emplace_back(Transformation{ 
				transform.getPointMatrix(),
				transform.getDirMatrix(), 
				transform.getPointInverseMatrix(), 
				transform.getDirInverseMatrix(), 
				transform.getNormalMatrix() 
			});
		}

		return newTransforms;
	}

	TransformationModel::~TransformationModel() {
		if (this->transformationStagingBuffer != nullptr) delete this->transformationStagingBuffer;
		if (this->transformationBuffer != nullptr) delete this->transformationBuffer;
	}

	void TransformationModel::createBuffers() {
		uint32_t instanceSize = static_cast<uint32_t>(sizeof(Transformation));

		this->transformationStagingBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
			VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT
		);

		this->transformationBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
			VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT
		);
	} 

	void TransformationModel::update(NugieVulkan::CommandBuffer* commandBuffer, std::vector<Transformation> transformations) {
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(Transformation)) * static_cast<VkDeviceSize>(transformations.size());

		this->transformationStagingBuffer->map();
		this->transformationStagingBuffer->writeToBuffer((void *) transformations.data(), bufferSize);
		
		this->transformationBuffer->copyFromAnotherBuffer(commandBuffer, this->transformationStagingBuffer, bufferSize);
	}

	void TransformationModel::update(NugieVulkan::CommandBuffer* commandBuffer, std::vector<TransformComponent> transformationComponents) {
		auto transformations = this->convertToMatrix(transformationComponents);
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(Transformation)) * static_cast<VkDeviceSize>(transformations.size());

		this->transformationStagingBuffer->map();
		this->transformationStagingBuffer->writeToBuffer((void *) transformations.data(), bufferSize);
		
		this->transformationBuffer->copyFromAnotherBuffer(commandBuffer, this->transformationStagingBuffer, bufferSize);

	}
} // namespace NugieApp

