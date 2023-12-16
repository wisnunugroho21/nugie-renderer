#include "model_deferred_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  ModelDeferredDescSet::ModelDeferredDescSet(NugieVulkan::Device* device, uint32_t pointLightNum, uint32_t spotLightNum, 
		NugieVulkan::DescriptorPool* descriptorPool, std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1], 
		VkDescriptorBufferInfo modelsInfo[4], std::vector<VkDescriptorImageInfo> renderTextureInfo[2], 
		std::vector<VkDescriptorImageInfo> objectTexturesInfo[1]) 
		: device{device}, descriptorPool{descriptorPool}, pointLightNum{pointLightNum}, spotLightNum{spotLightNum} 
	{
		this->objectTexturesInfoSize = objectTexturesInfo[0].size();

		this->createDescriptorLayout();
		this->createDescriptorSet(uniformBufferInfo, modelsInfo, renderTextureInfo, objectTexturesInfo);
  }

	ModelDeferredDescSet::~ModelDeferredDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

	void ModelDeferredDescSet::createDescriptorLayout() {
		this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(this->device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(5, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, this->pointLightNum)
				.addBinding(6, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, this->spotLightNum)
				.addBinding(7, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, this->objectTexturesInfoSize)
				.build();
	}

  void ModelDeferredDescSet::createDescriptorSet(std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1], 
		VkDescriptorBufferInfo modelsInfo[4], std::vector<VkDescriptorImageInfo> renderTextureInfo[2], 
		std::vector<VkDescriptorImageInfo> objectTexturesInfo[1])
	{
		std::vector<VkDescriptorImageInfo> newRenderTextureInfos[2];
		this->descriptorSets.clear();
		
		for (int i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			newRenderTextureInfos[0].clear();
			newRenderTextureInfos[1].clear();
			
			for (uint32_t j = 0; j < pointLightNum; j++) {
				uint32_t totalIndex = i * pointLightNum + j;
				newRenderTextureInfos[0].emplace_back(renderTextureInfo[0][totalIndex]);
			}

			for (uint32_t j = 0; j < spotLightNum; j++) {
				uint32_t totalIndex = i * spotLightNum + j;
				newRenderTextureInfos[1].emplace_back(renderTextureInfo[1][totalIndex]);
			}

			VkDescriptorSet descSet;

			NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool)
				.writeBuffer(0, uniformBufferInfo[0][i])
				.writeBuffer(1, modelsInfo[0])
				.writeBuffer(2, modelsInfo[1])
				.writeBuffer(3, modelsInfo[2])
				.writeBuffer(4, modelsInfo[3])
				.writeImage(5, newRenderTextureInfos[0])
				.writeImage(6, newRenderTextureInfos[1])
				.writeImage(7, objectTexturesInfo[0])
				.build(&descSet);

			this->descriptorSets.emplace_back(descSet);
		}
  }

	void ModelDeferredDescSet::deleteDescriptorSet() {
		this->descriptorPool->free(this->descriptorSets);
	}
}