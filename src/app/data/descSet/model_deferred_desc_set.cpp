#include "model_deferred_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  ModelDeferredDescSet::ModelDeferredDescSet(NugieVulkan::Device* device, uint32_t pointLightNum, uint32_t spotLightNum, 
		NugieVulkan::DescriptorPool* descriptorPool, std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1], 
		VkDescriptorBufferInfo modelsInfo[4], std::vector<VkDescriptorImageInfo> renderTextureInfo[2], 
		std::vector<VkDescriptorImageInfo> objectRexturesInfo[1]) 
	{
		this->createDescriptor(device, pointLightNum, spotLightNum, descriptorPool, uniformBufferInfo, 
			modelsInfo, renderTextureInfo, objectRexturesInfo);
  }

	ModelDeferredDescSet::~ModelDeferredDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

  void ModelDeferredDescSet::createDescriptor(NugieVulkan::Device* device, uint32_t pointLightNum, uint32_t spotLightNum, 
		NugieVulkan::DescriptorPool* descriptorPool, std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1], 
		VkDescriptorBufferInfo modelsInfo[4], std::vector<VkDescriptorImageInfo> renderTextureInfo[2], 
		std::vector<VkDescriptorImageInfo> objectRexturesInfo[1])
	{
    this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(5, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, pointLightNum)
				.addBinding(6, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, spotLightNum)
				.addBinding(7, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT, static_cast<uint32_t>(objectRexturesInfo[0].size()))
				.build();

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

			NugieVulkan::DescriptorWriter(device, this->descSetLayout, descriptorPool)
				.writeBuffer(0, uniformBufferInfo[0][i])
				.writeBuffer(1, modelsInfo[0])
				.writeBuffer(2, modelsInfo[1])
				.writeBuffer(3, modelsInfo[2])
				.writeBuffer(4, modelsInfo[3])
				.writeImage(5, newRenderTextureInfos[0])
				.writeImage(6, newRenderTextureInfos[1])
				.writeImage(7, objectRexturesInfo[0])
				.build(&descSet);

			this->descriptorSets.emplace_back(descSet);
		}
  }
}