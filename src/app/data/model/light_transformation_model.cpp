#include "light_transformation_model.hpp"

#include <cstring>
#include <iostream>
#include <unordered_map>

#define GLM_ENABLE_EXPERIMENTAL
#include <glm/gtx/hash.hpp>

namespace NugieApp {
	LightTransformationModel::LightTransformationModel(NugieVulkan::Device* device) : device{device} {
		this->createBuffers();
	}

	LightTransformationModel::~LightTransformationModel() {
		if (this->lightTransformationStagingBuffer != nullptr) delete this->lightTransformationStagingBuffer;
		if (this->lightTransformationBuffer != nullptr) delete this->lightTransformationBuffer;
	}

	void LightTransformationModel::createBuffers() {
		uint32_t instanceSize = static_cast<uint32_t>(sizeof(LightTransformation));

		this->lightTransformationStagingBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
			VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT
		);

		this->lightTransformationBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
			VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT
		);
	} 

	void LightTransformationModel::update(NugieVulkan::CommandBuffer* commandBuffer, std::vector<LightTransformation> lightTransformations) {
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(LightTransformation)) * static_cast<VkDeviceSize>(lightTransformations.size());

		this->lightTransformationStagingBuffer->map();
		this->lightTransformationStagingBuffer->writeToBuffer((void *) lightTransformations.data(), bufferSize);
		
		this->lightTransformationBuffer->copyFromAnotherBuffer(commandBuffer, this->lightTransformationStagingBuffer, bufferSize);
	}
} // namespace NugieApp

